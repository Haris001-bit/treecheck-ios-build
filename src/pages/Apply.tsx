import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle, TreePine } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-logo-dark.png';
import { Link } from 'react-router-dom';

export default function Apply() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await supabase.functions.invoke('submit-application', {
        body: { fullName, email, phone, companyName, city, message },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to submit application');
      }

      setSubmitted(true);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit application. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="absolute inset-0 gradient-primary opacity-5" />
        <Card className="w-full max-w-md relative text-center">
          <CardHeader className="space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl font-display">Application Received!</CardTitle>
            <CardDescription className="text-base">
              We'll review your application and get back to you within 1–2 business days. If approved, you'll receive an email with your invite link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/">
              <Button variant="outline" className="w-full">Back to Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="absolute inset-0 gradient-primary opacity-5" />

      <Card className="w-full max-w-lg relative mx-2">
        <CardHeader className="space-y-3 text-center px-4 sm:px-6">
          <div className="mx-auto">
            <img src={treecheckLogo} alt="TreeCheck Logo" className="h-14 sm:h-16 w-auto object-contain" />
          </div>
          <div>
            <CardTitle className="text-2xl font-display">Apply for TREECHECK</CardTitle>
            <CardDescription className="text-sm">
              Join our network of qualified tree service contractors and start receiving verified leads in your area.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  placeholder="John Smith"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  placeholder="Smith Tree Services"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@smithtree.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={20}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Primary Service City *</Label>
              <Input
                id="city"
                placeholder="Oklahoma City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Tell us about your business</Label>
              <Textarea
                id="message"
                placeholder="Years in business, services offered, team size, etc."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                rows={3}
              />
            </div>
            <Button type="submit" className="w-full" variant="cta" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <TreePine className="mr-2 h-4 w-4" />
                  Submit Application
                </>
              )}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Applications are reviewed within 1–2 business days. Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
