import { Settings2, HardHat } from 'lucide-react';
import { CompanySetupForm } from '@/components/CompanySetupForm';
import { ProductionCostsForm } from '@/components/production/ProductionCostsForm';
import { CalibrationPanel } from '@/components/production/CalibrationPanel';
import { useCompanySettings, usesProductionPlan } from '@/hooks/useCompanySettings';
import { ClosedDaysCard } from '@/components/ClosedDaysCard';
import { ConsultationNote } from '@/components/ConsultationNote';

export default function HowWeWork() {
  const { data: settings } = useCompanySettings();
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
        <Settings2 className="w-6 h-6 text-primary" /> How we work
      </h1>
      <p className="text-sm text-muted-foreground mb-6">Change these anytime. Menus and job alerts update right away.</p>
      <ConsultationNote className="mb-6" />
      <CompanySetupForm mode="page" />
      <ClosedDaysCard />
      {usesProductionPlan(settings) && (
        <div className="mt-8">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-1"><HardHat className="w-5 h-5 text-primary" />Production costs</h2>
          <p className="text-sm text-muted-foreground mb-4">Scout uses these to cost each job and recommend a price.</p>
          <ProductionCostsForm />
          <div className="mt-4"><CalibrationPanel /></div>
        </div>
      )}
    </div>
  );
}
