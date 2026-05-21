"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { BarChartComponent } from "@/components/charts/bar-chart";
import { PieChartComponent } from "@/components/charts/pie-chart";
import { LineChartComponent } from "@/components/charts/line-chart";
import { FunnelChartComponent } from "@/components/charts/funnel-chart";

const REPORT_TABS = [
  { label: "Lead Funnel", value: "lead-funnel" },
  { label: "Department", value: "department-performance" },
  { label: "Agent", value: "agent-performance" },
  { label: "Source", value: "source-analysis" },
  { label: "Follow-ups", value: "follow-up-effectiveness" },
  { label: "Trends", value: "time-trends" },
];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState("lead-funnel");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (res.ok) {
        const json = await res.json();
        setDepartments(json.departments || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: activeTab });
      if (departmentId) params.set("departmentId", departmentId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/reports?${params}`);
      if (res.ok) {
        setData(await res.json());
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeTab, departmentId, dateFrom, dateTo]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportCSV = async () => {
    const params = new URLSearchParams({ type: activeTab, format: "csv" });
    if (departmentId) params.set("departmentId", departmentId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    const res = await fetch(`/api/reports?${params}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeTab}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportPDF = () => {
    // Open a printable version in new window
    const params = new URLSearchParams({ type: activeTab });
    if (departmentId) params.set("departmentId", departmentId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const rows = data?.rows || [];
    const title = REPORT_TABS.find((t) => t.value === activeTab)?.label || activeTab;
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    const tableRows = rows
      .map(
        (row: Record<string, unknown>) =>
          `<tr>${headers.map((h) => `<td style="padding:8px;border:1px solid #ddd;">${row[h] ?? "-"}</td>`).join("")}</tr>`
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title} Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
          h1 { font-size: 24px; margin-bottom: 8px; }
          .meta { color: #666; font-size: 14px; margin-bottom: 24px; }
          table { border-collapse: collapse; width: 100%; margin-top: 16px; }
          th { background: #f3f4f6; padding: 10px 8px; border: 1px solid #ddd; text-align: left; font-size: 13px; }
          td { padding: 8px; border: 1px solid #ddd; font-size: 13px; }
          tr:nth-child(even) { background: #f9fafb; }
          @media print { body { margin: 20px; } }
        </style>
      </head>
      <body>
        <h1>${title} Report</h1>
        <div class="meta">
          ${dateFrom || dateTo ? `Period: ${dateFrom || "Start"} to ${dateTo || "Now"}` : "All time"}
          ${departmentId ? ` | Department filtered` : ""}
          <br>Generated: ${new Date().toLocaleString()}
        </div>
        ${data?.summary ? `<div style="margin-bottom:16px;padding:12px;background:#f3f4f6;border-radius:8px;">
          ${Object.entries(data.summary).map(([k, v]) => `<strong>${k.replace(/([A-Z])/g, " $1")}:</strong> ${v}`).join(" &nbsp;|&nbsp; ")}
        </div>` : ""}
        <table>
          <thead><tr>${headers.map((h) => `<th>${h.charAt(0).toUpperCase() + h.slice(1).replace(/([A-Z])/g, " $1")}</th>`).join("")}</tr></thead>
          <tbody>${tableRows || '<tr><td colspan="99" style="text-align:center;padding:20px;">No data</td></tr>'}</tbody>
        </table>
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Data-driven insights for your team">
        <Button variant="ghost" size="sm" onClick={handleExportCSV}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExportPDF}>
          <FileText className="h-4 w-4" />
          Export PDF
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4">
        <Tabs tabs={REPORT_TABS} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Content */}
      <div className="mt-6">
        {loading ? (
          <div className="space-y-4">
            <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
          </div>
        ) : (
          <ReportContent type={activeTab} data={data} />
        )}
      </div>
    </div>
  );
}

// ─── Report Content Renderers ───────────────────────────────────────────────

function ReportContent({ type, data }: { type: string; data: any }) {
  if (!data || !data.rows || data.rows.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center">
        <p className="text-sm text-gray-500">No data available for this report.</p>
      </div>
    );
  }

  switch (type) {
    case "lead-funnel":
      return <LeadFunnelReport data={data} />;
    case "department-performance":
      return <DepartmentReport data={data} />;
    case "agent-performance":
      return <AgentReport data={data} />;
    case "source-analysis":
      return <SourceReport data={data} />;
    case "follow-up-effectiveness":
      return <FollowUpReport data={data} />;
    case "time-trends":
      return <TimeTrendsReport data={data} />;
    default:
      return <GenericTable rows={data.rows} />;
  }
}

function SummaryCards({ summary }: { summary: Record<string, unknown> }) {
  if (!summary) return null;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      {Object.entries(summary).map(([key, value]) => (
        <div key={key} className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">
            {typeof value === "number" ? value.toLocaleString() : String(value)}
            {key.toLowerCase().includes("rate") ? "%" : ""}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1")}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadFunnelReport({ data }: { data: any }) {
  const chartData = data.rows.map((r: any) => ({
    name: r.stage,
    value: r.count,
    color: r.stageColor,
  }));

  return (
    <div>
      {data.summary && <SummaryCards summary={data.summary} />}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">Pipeline Funnel</h3>
        <FunnelChartComponent data={chartData} height={280} />
      </div>
      <div className="mt-4">
        <GenericTable rows={data.rows} />
      </div>
    </div>
  );
}

function DepartmentReport({ data }: { data: any }) {
  const chartData = data.rows.map((r: any) => ({
    name: r.department,
    totalLeads: r.totalLeads,
    converted: r.converted,
  }));

  return (
    <div>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">Department Comparison</h3>
        <BarChartComponent
          data={chartData}
          bars={[
            { dataKey: "totalLeads", color: "#6366f1", name: "Total Leads" },
            { dataKey: "converted", color: "#22c55e", name: "Converted" },
          ]}
          xKey="name"
          height={300}
          showLegend
        />
      </div>
      <div className="mt-4">
        <GenericTable rows={data.rows} />
      </div>
    </div>
  );
}

function AgentReport({ data }: { data: any }) {
  const chartData = data.rows.map((r: any) => ({
    name: r.agent,
    leadsAssigned: r.leadsAssigned,
    converted: r.converted,
  }));

  return (
    <div>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">Agent Performance</h3>
        <BarChartComponent
          data={chartData}
          bars={[
            { dataKey: "leadsAssigned", color: "#6366f1", name: "Assigned" },
            { dataKey: "converted", color: "#22c55e", name: "Converted" },
          ]}
          xKey="name"
          height={300}
          showLegend
        />
      </div>
      <div className="mt-4">
        <GenericTable rows={data.rows} />
      </div>
    </div>
  );
}

function SourceReport({ data }: { data: any }) {
  const pieData = data.rows.map((r: any) => ({
    name: r.source,
    value: r.leadCount,
  }));

  return (
    <div>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">Lead Sources</h3>
        <PieChartComponent data={pieData} height={300} />
      </div>
      <div className="mt-4">
        <GenericTable rows={data.rows} />
      </div>
    </div>
  );
}

function FollowUpReport({ data }: { data: any }) {
  const chartData = data.rows.map((r: any) => ({
    name: r.type,
    total: r.total,
    completed: r.completed,
  }));

  return (
    <div>
      {data.summary && <SummaryCards summary={data.summary} />}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">Follow-up by Type</h3>
        <BarChartComponent
          data={chartData}
          bars={[
            { dataKey: "total", color: "#6366f1", name: "Total" },
            { dataKey: "completed", color: "#22c55e", name: "Completed" },
          ]}
          xKey="name"
          height={300}
          showLegend
        />
      </div>
      <div className="mt-4">
        <GenericTable rows={data.rows} />
      </div>
    </div>
  );
}

function TimeTrendsReport({ data }: { data: any }) {
  const chartData = data.rows.map((r: any) => ({
    name: r.period,
    value: r.count,
  }));

  return (
    <div>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">
          Lead Volume ({data.granularity || "daily"})
        </h3>
        <LineChartComponent data={chartData} height={300} />
      </div>
      <div className="mt-4">
        <GenericTable rows={data.rows} />
      </div>
    </div>
  );
}

function GenericTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows || rows.length === 0) return null;

  const headers = Object.keys(rows[0]);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr>
              {headers.map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-gray-200 px-4 py-3 font-semibold text-gray-600">
                  {h.charAt(0).toUpperCase() + h.slice(1).replace(/([A-Z])/g, " $1")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                {headers.map((h) => (
                  <td key={h} className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {row[h] !== null && row[h] !== undefined ? String(row[h]) : "-"}
                    {h.toLowerCase().includes("rate") && row[h] !== null ? "%" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
