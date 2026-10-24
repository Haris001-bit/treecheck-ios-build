import { useNavigate } from 'react-router-dom';
import { CompanySetupForm } from '@/components/CompanySetupForm';

export default function Onboarding() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-lg py-8">
        <img src="/treecheck-logo-dark.png" alt="TreeCheck" className="h-8 mb-6" />
        <p className="text-sm text-muted-foreground mb-4">A few quick questions so TreeCheck fits how your company works. About a minute.</p>
        <CompanySetupForm mode="wizard" onDone={() => navigate('/dashboard/start', { replace: true })} />
      </div>
    </div>
  );
}
