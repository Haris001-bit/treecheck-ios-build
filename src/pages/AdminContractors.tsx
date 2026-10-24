import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Search, Users, ChevronRight } from 'lucide-react';

export default function AdminContractors() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCity = searchParams.get('city') || '';
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-contractors-all'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, company_name, email, phone, subscription_tier, credit_balance, is_active, created_at')
        .eq('role', 'contractor')
        .order('company_name', { ascending: true });
      if (error) throw error;

      const { data: areas, error: aErr } = await supabase
        .from('service_areas')
        .select('contractor_id, city');
      if (aErr) throw aErr;

      return { profiles: profiles || [], areas: areas || [] };
    },
  });

  const cityIndex = useMemo(() => {
    const map = new Map<string, Set<string>>();
    (data?.areas || []).forEach((a: any) => {
      const key = a.city.trim();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(a.contractor_id);
    });
    return Array.from(map.entries())
      .map(([city, ids]) => ({ city, count: ids.size, ids }))
      .sort((a, b) => a.city.localeCompare(b.city));
  }, [data]);

  const filteredCities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cityIndex;
    return cityIndex.filter((c) => c.city.toLowerCase().includes(q));
  }, [cityIndex, search]);

  const contractorsForCity = useMemo(() => {
    if (!selectedCity || !data) return [];
    const ids = cityIndex.find((c) => c.city === selectedCity)?.ids;
    if (!ids) return [];
    return data.profiles.filter((p: any) => ids.has(p.id));
  }, [selectedCity, data, cityIndex]);

  const allContractorsFiltered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return data.profiles.filter(
      (p: any) =>
        p.company_name?.toLowerCase().includes(q) ||
        p.full_name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q)
    );
  }, [data, search]);

  if (!isAdmin) {
    return <div className="p-8 text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="p-4 sm:p-8 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold text-foreground">Contractors</h1>
        <p className="text-muted-foreground mt-1">
          Search by city or contractor name to drill into contact info & purchase history.
        </p>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search city, company, name, email or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : selectedCity ? (
        <div>
          <button
            onClick={() => setSearchParams({})}
            className="text-sm text-primary hover:underline mb-4"
          >
            ← Back to cities
          </button>
          <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" /> {selectedCity}
            <Badge variant="secondary">{contractorsForCity.length}</Badge>
          </h2>
          <ContractorList contractors={contractorsForCity} />
        </div>
      ) : search.trim() ? (
        <div className="space-y-6">
          {filteredCities.length > 0 && (
            <div>
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">Cities</h2>
              <CityList cities={filteredCities} onSelect={(c) => setSearchParams({ city: c })} />
            </div>
          )}
          {allContractorsFiltered.length > 0 && (
            <div>
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">Contractors</h2>
              <ContractorList contractors={allContractorsFiltered} />
            </div>
          )}
          {filteredCities.length === 0 && allContractorsFiltered.length === 0 && (
            <p className="text-muted-foreground">No matches.</p>
          )}
        </div>
      ) : (
        <CityList cities={cityIndex} onSelect={(c) => setSearchParams({ city: c })} />
      )}
    </div>
  );
}

function CityList({ cities, onSelect }: { cities: { city: string; count: number }[]; onSelect: (c: string) => void }) {
  return (
    <div className="space-y-2">
      {cities.map((c) => (
        <button
          key={c.city}
          onClick={() => onSelect(c.city)}
          className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-lg hover:border-primary transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <MapPin className="w-4 h-4 text-primary" />
            <span className="font-medium">{c.city}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="w-4 h-4" />
            <span className="text-sm">{c.count}</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>
      ))}
    </div>
  );
}

function ContractorList({ contractors }: { contractors: any[] }) {
  if (contractors.length === 0) return <p className="text-muted-foreground">No contractors here.</p>;
  return (
    <div className="space-y-2">
      {contractors.map((c) => (
        <Link
          key={c.id}
          to={`/dashboard/admin/contractors/${c.id}`}
          className="block"
        >
          <Card className="hover:border-primary transition-colors">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">{c.company_name || c.full_name || c.email}</span>
                  {c.subscription_tier === 'pro' && <Badge>Premium</Badge>}
                  {!c.is_active && <Badge variant="destructive">Inactive</Badge>}
                </div>
                {c.full_name && c.company_name && (
                  <div className="text-sm text-muted-foreground truncate">{c.full_name}</div>
                )}
                <div className="text-xs text-muted-foreground truncate">{c.email}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-medium">${Number(c.credit_balance || 0).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">credits</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
