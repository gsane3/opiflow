import QuickAssistantInput from '@/components/dashboard/QuickAssistantInput';
import MissedCallsSection from '@/components/dashboard/MissedCallsSection';
import LeadsSection from '@/components/dashboard/LeadsSection';
import TodayTasksSection from '@/components/dashboard/TodayTasksSection';
import OpenOffersSection from '@/components/dashboard/OpenOffersSection';
import RecentCallsSection from '@/components/dashboard/RecentCallsSection';

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">
          Καλημέρα. Τι πρέπει να γίνει σήμερα;
        </h1>
      </div>

      <QuickAssistantInput />

      <MissedCallsSection />
      <LeadsSection />
      <TodayTasksSection />
      <OpenOffersSection />
      <RecentCallsSection />
    </div>
  );
}
