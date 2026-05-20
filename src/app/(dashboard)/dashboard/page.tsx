import { PageHeader } from "@/components/layout/page-header";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your CRM activity"
      />
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
        Dashboard widgets will appear here.
      </div>
    </div>
  );
}
