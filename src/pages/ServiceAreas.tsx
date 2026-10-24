import { useState } from 'react';
import { useServiceAreas, useAddServiceArea, useRemoveServiceArea } from '@/hooks/useServiceAreas';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Plus, X, Loader2 } from 'lucide-react';

export default function ServiceAreas() {
  const { data: serviceAreas, isLoading } = useServiceAreas();
  const addMutation = useAddServiceArea();
  const removeMutation = useRemoveServiceArea();

  const [newCity, setNewCity] = useState('');
  const [newRegion, setNewRegion] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCity.trim()) return;
    
    addMutation.mutate(
      { city: newCity.trim(), region: newRegion.trim() || undefined },
      {
        onSuccess: () => {
          setNewCity('');
          setNewRegion('');
        },
      }
    );
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Service Areas</h1>
        <p className="text-muted-foreground mt-1">
          Manage the cities and regions where you provide tree services
        </p>
      </div>

      {/* Add New Area */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Add Service Area</CardTitle>
          <CardDescription>
            Enter a city name to receive leads from that area
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="city">City Name</Label>
              <Input
                id="city"
                placeholder="e.g., Austin"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                required
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="region">State/Region (optional)</Label>
              <Input
                id="region"
                placeholder="e.g., Texas"
                value={newRegion}
                onChange={(e) => setNewRegion(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button 
                type="submit" 
                disabled={addMutation.isPending || !newCity.trim()}
                className="gradient-primary"
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Current Service Areas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Service Areas</CardTitle>
          <CardDescription>
            You'll receive leads from these locations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : serviceAreas?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No service areas added yet.</p>
              <p className="text-sm">Add your first city above to start receiving leads.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {serviceAreas?.map((area) => (
                <Badge
                  key={area.id}
                  variant="secondary"
                  className="text-base py-2 px-4 flex items-center gap-2"
                >
                  <MapPin className="h-4 w-4" />
                  {area.city}
                  {area.region && <span className="text-muted-foreground">, {area.region}</span>}
                  <button
                    onClick={() => removeMutation.mutate(area.id)}
                    disabled={removeMutation.isPending}
                    className="ml-1 hover:text-destructive transition-colors"
                    aria-label={`Remove ${area.city}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
