// The confirm-days screen greys out days already booked in Jobber, as well as closed days, so the climber
// sees what's available before tapping anything. The backend is mocked: closed weekdays come from the
// job_closed_weekdays RPC and booked days from the jobber-free-days function.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLOSED = [4, 5]; // Thursday and Friday
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
// The first two open weekdays from the day after tomorrow, whatever today is.
const openDays = Array.from({ length: 14 }, (_, i) => format(addDays(new Date(), i + 2), "yyyy-MM-dd"))
  .filter((d) => ![0, 6, ...CLOSED].includes(weekday(d)))
  .slice(0, 2);
const BOOKED = openDays[0];
const FREE = openDays[1];

const invoke = vi.fn(async (name: string, _opts?: unknown) =>
  name === "jobber-free-days"
    ? { data: { source: "jobber", blocked: [{ date: BOOKED, status: "busy" }] }, error: null }
    : { data: { success: true }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: [{ closed_weekdays: CLOSED }], error: null })),
    functions: { invoke: (name: string, opts: unknown) => invoke(name, opts) },
  },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { ConfirmClimberDates } from "./ConfirmClimberDates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function show(el: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}>{el}</QueryClientProvider>));
  // Let both queries resolve and the effects run.
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function buttonsByDate() {
  // The grid shows 28 days from today in order; map each button to its date.
  const days = Array.from({ length: 28 }, (_, i) => format(addDays(new Date(), i), "yyyy-MM-dd"));
  const buttons = [...host.querySelectorAll(".grid button")];
  return new Map(days.map((d, i) => [d, buttons[i]]));
}

describe("ConfirmClimberDates", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    invoke.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("greys out a day booked in Jobber before the climber taps it, and keeps open days pickable", async () => {
    await show(<ConfirmClimberDates requestId="R1" suggested={[]} />);
    expect(invoke).toHaveBeenCalledWith("jobber-free-days", { body: { bid_request_id: "R1" } });
    const booked = buttonsByDate().get(BOOKED) as HTMLButtonElement;
    const free = buttonsByDate().get(FREE) as HTMLButtonElement;
    expect(booked.textContent).toContain("Booked");
    expect(booked.disabled).toBe(true);
    expect(free.textContent).toContain(format(parseISO(FREE), "MMM d"));
    expect(free.disabled).toBe(false);
  });

  it("drops a suggested day that is booked and says why", async () => {
    await show(<ConfirmClimberDates requestId="R1" suggested={[BOOKED, FREE]} />);
    expect(host.textContent).toContain(`${format(parseISO(BOOKED), "EEE MMM d")} is already booked in Jobber and can't be used.`);
    // Only the free day stays picked: the button shows a count of 1.
    expect(host.textContent).toContain("Confirm my days (1)");
  });

  it("keeps a day the ground crew is already hired for, even if Jobber has it booked", async () => {
    await show(<ConfirmClimberDates requestId="R1" suggested={[BOOKED]} locked={[BOOKED]} />);
    const locked = buttonsByDate().get(BOOKED) as HTMLButtonElement;
    expect(locked.textContent).not.toContain("Booked");
    expect(host.textContent).toContain("Confirm my days (1)");
  });
});
