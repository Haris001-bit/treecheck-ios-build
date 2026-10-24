import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;

declare global {
  interface Window { __gmapsLoading?: Promise<void>; initGmaps?: () => void; google?: any; }
}

function loadMaps(): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoading) return window.__gmapsLoading;
  window.__gmapsLoading = new Promise((resolve, reject) => {
    window.initGmaps = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&libraries=places&loading=async&callback=initGmaps&channel=${TRACKING_ID ?? ''}`;
    s.async = true;
    s.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });
  return window.__gmapsLoading;
}

export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface Props {
  value: string;
  onChange: (street: string) => void;
  onSelect: (parts: AddressParts) => void;
  placeholder?: string;
}

export function AddressAutocomplete({ value, onChange, onSelect, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const sessionTokenRef = useRef<any>(null);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleInput = (next: string) => {
    onChange(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (next.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        await loadMaps();
        const { AutocompleteSuggestion, AutocompleteSessionToken } =
          await window.google.maps.importLibrary('places');
        if (!sessionTokenRef.current) sessionTokenRef.current = new AutocompleteSessionToken();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: next,
          sessionToken: sessionTokenRef.current,
          includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
          includedRegionCodes: ['us'],
        });
        setSuggestions(suggestions ?? []);
        setOpen(true);
      } catch (e) {
        console.error('autocomplete error', e);
        setSuggestions([]);
      } finally { setLoading(false); }
    }, 250);
  };

  const handlePick = async (s: any) => {
    setOpen(false);
    try {
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });
      const components = place.addressComponents ?? [];
      const get = (type: string, short = false) => {
        const c = components.find((c: any) => c.types?.includes(type));
        return c ? (short ? (c.shortText ?? c.short_name ?? '') : (c.longText ?? c.long_name ?? '')) : '';
      };
      const streetNumber = get('street_number');
      const route = get('route');
      const parts: AddressParts = {
        street: [streetNumber, route].filter(Boolean).join(' '),
        city: get('locality') || get('sublocality') || get('postal_town'),
        state: get('administrative_area_level_1', true),
        zip: get('postal_code'),
      };
      onSelect(parts);
      sessionTokenRef.current = null; // close session after pick
    } catch (e) {
      console.error('place details error', e);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={placeholder ?? 'Street address'}
        autoComplete="off"
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {loading && (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((s, i) => {
            const p = s.placePrediction;
            return (
              <button
                key={i}
                type="button"
                onClick={() => handlePick(s)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition border-b last:border-b-0"
              >
                <div className="font-medium">{p.mainText?.text ?? p.text?.text}</div>
                {p.secondaryText?.text && (
                  <div className="text-xs text-muted-foreground">{p.secondaryText.text}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
