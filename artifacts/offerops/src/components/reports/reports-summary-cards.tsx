import { Card, CardContent } from "@/components/ui/card";
import {
  fmtReportMoney,
  fmtReportPct,
  fmtReportVisits,
  reportProfitColor,
  reportRoiColor,
} from "@/components/reports/reports-analytics";
import { BarChart3, DollarSign, MousePointerClick, Percent, Trophy, TrendingUp } from "lucide-react";

export type ReportsRangeSummary = {
  visits: number;
  spend: number;
  revenue: number;
  profit: number;
  roi: number;
  winners: number;
  losers: number;
  batchCount: number;
  hasImportedMetrics: boolean;
  isFiltered: boolean;
};

function supportText(summary: ReportsRangeSummary): string {
  if (!summary.hasImportedMetrics) return "No imported metrics";
  const parts: string[] = ["Selected range"];
  if (summary.batchCount > 0) {
    parts.push(`Across ${summary.batchCount} batch${summary.batchCount === 1 ? "" : "es"}`);
  }
  if (summary.isFiltered) parts.push("Filtered view");
  return parts.join(" · ");
}

export function ReportsSummaryCards({ summary }: { summary: ReportsRangeSummary }) {
  const sub = supportText(summary);
  const noData = !summary.hasImportedMetrics;

  const cards = [
    {
      label: "Visits",
      value: noData ? "—" : fmtReportVisits(summary.visits),
      color: noData ? "text-slate-400" : "text-slate-900",
      icon: MousePointerClick,
    },
    {
      label: "Spend",
      value: noData ? "—" : fmtReportMoney(summary.spend),
      color: noData ? "text-slate-400" : "text-slate-700",
      icon: DollarSign,
    },
    {
      label: "Revenue",
      value: noData ? "—" : fmtReportMoney(summary.revenue),
      color: noData ? "text-slate-400" : "text-slate-900",
      icon: BarChart3,
    },
    {
      label: "Profit",
      value: noData ? "—" : fmtReportMoney(summary.profit),
      color: noData ? "text-slate-400" : reportProfitColor(summary.profit),
      icon: TrendingUp,
    },
    {
      label: "ROI",
      value: noData ? "—" : fmtReportPct(summary.roi),
      color: noData ? "text-slate-400" : reportRoiColor(summary.roi),
      icon: Percent,
    },
    {
      label: "W / L",
      value: noData ? "—" : `${summary.winners} / ${summary.losers}`,
      color: noData ? "text-slate-400" : "text-slate-900",
      icon: Trophy,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cards.map(({ label, value, color, icon: Icon }) => (
        <Card
          key={label}
          className="border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100"
        >
          <CardContent className="px-4 py-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
              <Icon className="h-3.5 w-3.5 text-slate-300" />
            </div>
            <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="mt-1 text-[10px] text-slate-500">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
