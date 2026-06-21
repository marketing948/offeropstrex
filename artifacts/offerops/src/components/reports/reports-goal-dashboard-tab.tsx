import { Card, CardContent } from "@/components/ui/card";
import { ReportKpiCardsSkeleton } from "@/components/operational-state/operational-skeletons";
import { ReportBreakdownChips } from "@/components/reports/report-breakdown-chips";
import { fmtReportMoney } from "@/components/reports/reports-analytics";
import type {
  GoalEmployeeRow,
  GoalGeoRow,
  GoalNetworkRow,
  GoalRowStatus,
  GoalSectionModel,
  ReportsGoalDashboardModel,
} from "@/lib/reports/reports-goal-dashboard";
import { cn } from "@/lib/utils";

function statusPillClass(status: GoalRowStatus): string {
  switch (status) {
    case "On track":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "Contributing":
      return "border-emerald-200 bg-emerald-50/70 text-emerald-700";
    case "Behind":
    case "Needs volume":
      return "border-orange-300 bg-orange-50 text-orange-800";
    case "No data":
      return "border-slate-200 bg-slate-100 text-slate-500";
    default:
      return "border-slate-300 bg-slate-100 text-slate-600";
  }
}

function GoalStatusPill({ status }: { status: GoalRowStatus }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
        statusPillClass(status),
      )}
    >
      {status}
    </span>
  );
}

function fmtGoalValue(value: number, kind: "currency" | "count"): string {
  return kind === "currency" ? fmtReportMoney(value) : String(value);
}

function fmtGoalCell(value: number | null | undefined, kind: "currency" | "count"): string {
  if (value == null) return "—";
  return fmtGoalValue(value, kind);
}

function fmtPctCell(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value}%`;
}

function SummaryMiniCards({
  summary,
  kind,
  labels,
}: {
  summary: GoalSectionModel["summary"];
  kind: "currency" | "count";
  labels: { current: string; goal: string; remaining: string; progress: string };
}) {
  const cards = [
    { label: labels.current, value: fmtGoalValue(summary.current, kind) },
    {
      label: labels.goal,
      value: summary.targetConfigured
        ? fmtGoalValue(summary.target ?? 0, kind)
        : summary.noGoalMessage ?? "No target",
    },
    {
      label: labels.remaining,
      value: summary.remaining != null ? fmtGoalValue(summary.remaining, kind) : "—",
    },
    { label: labels.progress, value: fmtPctCell(summary.progressPct) },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label} className="border border-slate-200/90 bg-white shadow-sm">
          <CardContent className="px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmployeeTable({
  rows,
  kind,
  countLabel,
  variant,
}: {
  rows: GoalEmployeeRow[];
  kind: "currency" | "count";
  countLabel: string;
  variant: "revenue" | "pipeline";
}) {
  return (
    <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm">
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: variant === "revenue" ? "14%" : "13%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          {variant === "revenue" ? (
            <>
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
            </>
          ) : (
            <>
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
            </>
          )}
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead className="border-b border-slate-100 bg-slate-50/95">
          <tr>
            <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Employee</th>
            <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">{countLabel}</th>
            <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Goal</th>
            <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Progress</th>
            <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Remaining</th>
            {variant === "revenue" ? (
              <>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Top Network</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Top GEO</th>
              </>
            ) : (
              <>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Networks</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">GEOs</th>
              </>
            )}
            <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-2 py-4 text-center text-xs text-slate-500">
                No employee data for the selected filters.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.employeeId} className="hover:bg-slate-50/80">
                <td className="min-w-0 px-2 py-2 align-top">
                  <p className="truncate text-sm font-medium text-slate-900" title={r.name}>{r.name}</p>
                </td>
                <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                  {fmtGoalValue(r.count, kind)}
                </td>
                <td className="min-w-0 px-2 py-2 text-right text-xs text-slate-500">No target</td>
                <td className="min-w-0 px-2 py-2 text-right text-xs text-slate-500">—</td>
                <td className="min-w-0 px-2 py-2 text-right text-xs text-slate-500">—</td>
                {variant === "revenue" ? (
                  <>
                    <td className="min-w-0 px-2 py-2 text-xs text-slate-700 truncate" title={r.topNetwork}>{r.topNetwork}</td>
                    <td className="min-w-0 px-2 py-2 text-xs text-slate-700 truncate" title={r.topGeo}>{r.topGeo}</td>
                  </>
                ) : (
                  <>
                    <td className="min-w-0 px-2 py-2 align-top">
                      <ReportBreakdownChips items={r.networks} maxVisible={2} />
                    </td>
                    <td className="min-w-0 px-2 py-2 align-top">
                      <ReportBreakdownChips items={r.geos} maxVisible={2} />
                    </td>
                  </>
                )}
                <td className="min-w-0 px-2 py-2 align-top">
                  <GoalStatusPill status={r.status} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

function NetworkTable({
  rows,
  kind,
  valueLabel,
  showGoal = true,
}: {
  rows: GoalNetworkRow[];
  kind: "currency" | "count";
  valueLabel: string;
  showGoal?: boolean;
}) {
  return (
    <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm">
      <table className="w-full table-fixed">
        <thead className="border-b border-slate-100 bg-slate-50/95">
          <tr>
            <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Network</th>
            <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">{valueLabel}</th>
            {showGoal && (
              <>
                <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Goal</th>
                <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Progress</th>
                <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Remaining</th>
              </>
            )}
            <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">GEOs</th>
            <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Employees</th>
            <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showGoal ? 8 : 5} className="px-2 py-4 text-center text-xs text-slate-500">
                No network breakdown for the selected filters.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.network} className="hover:bg-slate-50/80">
                <td className="min-w-0 px-2 py-2 text-sm font-medium text-slate-900 truncate" title={r.network}>{r.network}</td>
                <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums font-semibold whitespace-nowrap">{fmtGoalValue(r.count, kind)}</td>
                {showGoal && (
                  <>
                    <td className="min-w-0 px-2 py-2 text-right text-xs text-slate-600 whitespace-nowrap">
                      {r.goalConfigured ? fmtGoalCell(r.goal, kind) : "No target"}
                    </td>
                    <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap">{fmtPctCell(r.progressPct)}</td>
                    <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap">{fmtGoalCell(r.remaining, kind)}</td>
                  </>
                )}
                <td className="min-w-0 px-2 py-2 align-top">
                  <ReportBreakdownChips items={r.geos} maxVisible={2} />
                </td>
                <td className="min-w-0 px-2 py-2 align-top">
                  <ReportBreakdownChips items={r.employees} maxVisible={2} />
                </td>
                <td className="min-w-0 px-2 py-2 align-top">
                  <GoalStatusPill status={r.status} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

function GeoTable({
  rows,
  kind,
  valueLabel,
  title,
}: {
  rows: GoalGeoRow[];
  kind: "currency" | "count";
  valueLabel: string;
  title: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-700">{title}</p>
      <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm">
        <table className="w-full table-fixed">
          <thead className="border-b border-slate-100 bg-slate-50/95">
            <tr>
              <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">GEO</th>
              <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">{valueLabel}</th>
              {kind === "currency" && (
                <>
                  <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Goal</th>
                  <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Progress</th>
                </>
              )}
              <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Top Network</th>
              <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Campaigns</th>
              <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={kind === "currency" ? 7 : 5} className="px-2 py-4 text-center text-xs text-slate-500">
                  No GEO breakdown for the selected filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.geo} className="hover:bg-slate-50/80">
                  <td className="min-w-0 px-2 py-2 text-sm font-medium text-slate-900">{r.geo}</td>
                  <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums font-semibold whitespace-nowrap">{fmtGoalValue(r.count, kind)}</td>
                  {kind === "currency" && (
                    <>
                      <td className="min-w-0 px-2 py-2 text-right text-xs text-slate-600 whitespace-nowrap">
                        {r.goalConfigured ? fmtGoalCell(r.goal, kind) : "No target"}
                      </td>
                      <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap">{fmtPctCell(r.progressPct)}</td>
                    </>
                  )}
                  <td className="min-w-0 px-2 py-2 text-xs text-slate-700 truncate" title={r.topNetwork}>{r.topNetwork}</td>
                  <td className="min-w-0 px-2 py-2 text-right text-xs tabular-nums text-slate-600">{r.campaigns}</td>
                  <td className="min-w-0 px-2 py-2 align-top">
                    <GoalStatusPill status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function GoalSection({
  title,
  accentClass,
  section,
  kind,
  countLabel,
  networkTitle,
  geoTitle,
  summaryLabels,
  employeeVariant,
}: {
  title: string;
  accentClass: string;
  section: GoalSectionModel;
  kind: "currency" | "count";
  countLabel: string;
  networkTitle: string;
  geoTitle: string;
  summaryLabels: { current: string; goal: string; remaining: string; progress: string };
  employeeVariant: "revenue" | "pipeline";
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-100 border-l-4", accentClass)}>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-4">
        <SummaryMiniCards summary={section.summary} kind={kind} labels={summaryLabels} />
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-700">By employee</p>
          <EmployeeTable rows={section.employees} kind={kind} countLabel={countLabel} variant={employeeVariant} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">{networkTitle}</p>
            <NetworkTable
              rows={section.byNetwork}
              kind={kind}
              valueLabel={countLabel}
              showGoal={kind === "currency" || section.byNetwork.some((r) => r.goalConfigured)}
            />
          </div>
          <GeoTable rows={section.byGeo} kind={kind} valueLabel={countLabel} title={geoTitle} />
        </div>
      </div>
    </section>
  );
}

export function ReportsGoalDashboardTab({
  loading,
  isAdmin,
  model,
}: {
  loading: boolean;
  isAdmin: boolean;
  model: ReportsGoalDashboardModel;
}) {
  if (loading) {
    return (
      <div className="space-y-5">
        <ReportKpiCardsSkeleton count={4} />
        <ReportKpiCardsSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">Goal Dashboard</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Detailed breakdown of Operation Hub goals by employee, network, and GEO.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Uses the same goal areas as Operation Hub: Revenue, Testing Pipeline, and Working Campaigns.
        </p>
        <p className="mt-1 text-xs font-medium text-slate-600">
          {isAdmin ? "Executive View · all visible operators" : "My Goal Dashboard · your assigned campaigns"}
        </p>
      </div>

      <GoalSection
        title="Revenue Breakdown"
        accentClass="border-l-emerald-500"
        section={model.revenue}
        kind="currency"
        countLabel="Revenue"
        networkTitle="Revenue by Network"
        geoTitle="Revenue by GEO"
        employeeVariant="revenue"
        summaryLabels={{
          current: "Current Revenue",
          goal: "Revenue Goal",
          remaining: "Remaining",
          progress: "Progress %",
        }}
      />

      <GoalSection
        title="Testing Pipeline Breakdown"
        accentClass="border-l-violet-500"
        section={model.testing}
        kind="count"
        countLabel="Test Campaigns"
        networkTitle="Tests by Network"
        geoTitle="Tests by GEO"
        employeeVariant="pipeline"
        summaryLabels={{
          current: "Current Test Campaigns",
          goal: "Testing Goal",
          remaining: "Remaining",
          progress: "Progress %",
        }}
      />

      <GoalSection
        title="Working Campaigns Breakdown"
        accentClass="border-l-orange-500"
        section={model.working}
        kind="count"
        countLabel="Working Campaigns"
        networkTitle="Working by Network"
        geoTitle="Working by GEO"
        employeeVariant="pipeline"
        summaryLabels={{
          current: "Current Working Campaigns",
          goal: "Working Goal",
          remaining: "Remaining",
          progress: "Progress %",
        }}
      />
    </div>
  );
}
