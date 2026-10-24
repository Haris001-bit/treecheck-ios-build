import { Link } from 'react-router-dom';
import { FolderCog, Wallet, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useCompanySettings, usesSubs } from '@/hooks/useCompanySettings';

export default function SettingsAdmin() {
  const { isAdmin } = useAuth();
  const { data: company } = useCompanySettings();

  return (
    <section className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <h1 className="flex items-center gap-3 text-3xl font-black">
        <FolderCog className="h-7 w-7 text-primary" /> Admin
      </h1>
      {(isAdmin || usesSubs(company)) && (
        <Button asChild variant="outline" className="h-auto w-full justify-start gap-3 py-4">
          <Link to="/dashboard/pay">
            <Wallet className="h-5 w-5 text-primary" />
            <span>Pay</span>
            <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </Link>
        </Button>
      )}
    </section>
  );
}