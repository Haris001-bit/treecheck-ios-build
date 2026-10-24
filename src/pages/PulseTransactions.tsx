import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ListChecks, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PulseGate from "@/components/pulse/PulseGate";
import { usePulseAccess } from "@/hooks/pulse/usePulseAccess";
import { cn } from "@/lib/utils";
import { GOOD_CHIP, GOOD_TEXT } from "@/components/pulse/tone";

const PAGE_SIZE = 50;
const TXN_COLUMNS =
  "transaction_id, txn_date, name, merchant_name, amount, pending, treatment, category_key, exclude_reason, account_row_id";

type Filter = "all" | "counted" | "excluded" | "pending";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "counted", label: "Counted" },
  { value: "excluded", label: "Not counted" },
  { value: "pending", label: "Pending" },
];

// Names for the default categories (M2 pulse_seed_categories), used when the company's own list
// is missing one, so a raw key never shows.
const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  payroll_contractors: "Payroll and contractors",
  fuel_equipment: "Fuel and equipment",
  job_fees: "Job fees",
  operating: "Operating costs",
  other: "Other",
};

const EXCLUDE_LABELS: Record<string, string> = {
  card_payment: "Card payment",
  loan_payment: "Loan payment",
  own_transfer: "Transfer between your accounts",
  personal: "Personal / owner draw",
  before_count_from: "Before count-from date",
  inflow: "Money in (not revenue)",
  non_business_account: "Not a business account",
  pending: "Pending, not counted yet",
};

interface TxnRow {
  transaction_id: string;
  txn_date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  treatment: string;
  category_key: string | null;
  exclude_reason: string | null;
  account_row_id: string;
}

interface TxnPage {
  rows: TxnRow[];
  from: number;
  total: number | null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatDay(value: string): string {
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function isFilter(value: string): value is Filter {
  return FILTERS.some((f) => f.value === value);
}

export default function PulseTransactions() {
  return (
    <PulseGate>
      <PulseTransactionsContent />
    </PulseGate>
  );
}

function PulseTransactionsContent() {
  const { ownerId } = usePulseAccess();
  const [filter, setFilter] = useState<Filter>("all");

  const accountsQuery = useQuery({
    queryKey: ["pulse", ownerId, "account-labels"],
    enabled: !!ownerId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!ownerId) return [];
      const { data, error } = await supabase
        .from("plaid_accounts")
        .select("id, name, mask")
        .eq("owner_id", ownerId);
      if (error) throw new Error("pulse_accounts_failed");
      return data ?? [];
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ["pulse", ownerId, "categories"],
    enabled: !!ownerId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!ownerId) return [];
      const { data, error } = await supabase
        .from("pulse_categories")
        .select("key, label")
        .eq("owner_id", ownerId);
      if (error) throw new Error("pulse_categories_failed");
      return data ?? [];
    },
  });

  const txQuery = useInfiniteQuery({
    queryKey: ["pulse", ownerId, "transactions", filter],
    enabled: !!ownerId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<TxnPage> => {
      const from = pageParam;
      if (!ownerId) return { rows: [], from, total: 0 };
      let q = supabase
        .from("plaid_transactions")
        .select(TXN_COLUMNS, from === 0 ? { count: "exact" } : undefined)
        .eq("owner_id", ownerId);
      if (filter === "counted") q = q.in("treatment", ["cost", "refund"]).eq("pending", false);
      else if (filter === "excluded") q = q.eq("treatment", "excluded");
      else if (filter === "pending") q = q.eq("pending", true);
      const { data, error, count } = await q
        .order("txn_date", { ascending: false })
        .order("transaction_id", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error("pulse_transactions_failed");
      return { rows: (data ?? []) as TxnRow[], from, total: typeof count === "number" ? count : null };
    },
    getNextPageParam: (last) => (last.rows.length === PAGE_SIZE ? last.from + PAGE_SIZE : undefined),
  });

  const accountLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accountsQuery.data ?? []) {
      map.set(a.id, a.mask ? `...${a.mask}` : a.name || "Account");
    }
    return map;
  }, [accountsQuery.data]);

  const categoryLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categoriesQuery.data ?? []) map.set(c.key, c.label);
    return map;
  }, [categoriesQuery.data]);

  const rows = useMemo(() => txQuery.data?.pages.flatMap((p) => p.rows) ?? [], [txQuery.data]);
  const total = txQuery.data?.pages[0]?.total ?? null;

  const badgeFor = (t: TxnRow): { text: string; className: string } => {
    switch (t.treatment) {
      case "cost":
        return {
          text: (t.category_key && (categoryLabels.get(t.category_key) || DEFAULT_CATEGORY_LABELS[t.category_key])) || "Cost",
          className: "text-foreground",
        };
      case "refund":
        return { text: "Refund", className: GOOD_CHIP };
      case "excluded":
        return {
          text: (t.exclude_reason && EXCLUDE_LABELS[t.exclude_reason]) || "Not counted",
          className: "text-muted-foreground",
        };
      default:
        return { text: "Sorting...", className: "text-muted-foreground" };
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div className="space-y-1">
        <Link
          to="/dashboard/pulse"
          className="inline-flex items-center rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Financial Pulse
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-primary shrink-0" /> Your transactions
        </h1>
        <p className="text-sm text-muted-foreground">
          How TreeCheck sorted the money going in and out of your linked accounts. Revenue comes from Jobber, not from
          the bank.
        </p>
      </div>

      <Tabs value={filter} onValueChange={(v) => isFilter(v) && setFilter(v)}>
        <TabsList className="w-full sm:w-auto">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value} className="flex-1 sm:flex-none">
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="overflow-hidden">
        {txQuery.isPending ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading transactions...
          </div>
        ) : txQuery.isError && rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground space-y-3">
            <div>We couldn't load your transactions.</div>
            <Button variant="outline" size="sm" onClick={() => void txQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {filter === "all"
              ? "No transactions yet. After you link a bank and save your business accounts, they show up here."
              : "No transactions here."}
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b text-sm text-muted-foreground">
              Showing {rows.length}
              {total !== null ? ` of ${total}` : ""} transaction{(total ?? rows.length) === 1 ? "" : "s"}
            </div>
            <ul className="divide-y">
              {rows.map((t) => {
                const amount = Number(t.amount) || 0;
                const moneyOut = amount > 0;
                const badge = badgeFor(t);
                const account = accountLabels.get(t.account_row_id);
                return (
                  <li key={t.transaction_id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-bold truncate">{t.merchant_name || t.name || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDay(t.txn_date)}
                        {account ? ` - ${account}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div
                        className={cn(
                          "font-bold tabular-nums",
                          !moneyOut && amount !== 0 && GOOD_TEXT,
                          t.pending && "text-muted-foreground",
                        )}
                      >
                        {moneyOut ? "-" : amount < 0 ? "+" : ""}
                        {usd.format(Math.abs(amount))}
                        <span className="sr-only">{moneyOut ? " money out" : " money in"}</span>
                      </div>
                      <Badge variant="outline" className={cn("font-normal", badge.className)}>
                        {badge.text}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
            {txQuery.hasNextPage && (
              <div className="p-4 border-t flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => void txQuery.fetchNextPage()}
                  disabled={txQuery.isFetchingNextPage}
                >
                  {txQuery.isFetchingNextPage ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
