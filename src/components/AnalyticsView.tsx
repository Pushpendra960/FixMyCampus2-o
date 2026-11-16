import React, { useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  Building,
  CheckCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { CampusTicket, IssueCategory, RoomRecord } from '../types/campus';
import { DEPARTMENTS } from '../data/mockData';

interface AnalyticsViewProps {
  tickets: CampusTicket[];
  rooms: RoomRecord[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ tickets, rooms }) => {
  const SLA_TARGET_HOURS = 4;

  // Compute actual resolution metrics from tickets with valid timestamps
  const slaMetrics = useMemo(() => {
    const parseResolutionHours = (t: CampusTicket): number | null => {
      if (!t.resolution?.resolvedAt || !t.reportedAt) return null;
      const start = Date.parse(t.reportedAt);
      const end = Date.parse(t.resolution.resolvedAt);
      if (isNaN(start) || isNaN(end) || end < start) return null;
      return (end - start) / (1000 * 60 * 60);
    };

    const resolvedDurations: number[] = [];
    const byDept: Record<string, number[]> = {};

    for (const t of tickets) {
      const hrs = parseResolutionHours(t);
      if (hrs !== null) {
        resolvedDurations.push(hrs);
        const dept = t.recommendedDepartment || 'General Administration';
        if (!byDept[dept]) byDept[dept] = [];
        byDept[dept].push(hrs);
      }
    }

    const withinSlaCount = resolvedDurations.filter((h) => h <= SLA_TARGET_HOURS).length;
    const compliancePct =
      resolvedDurations.length > 0
        ? Math.round((withinSlaCount / resolvedDurations.length) * 1000) / 10
        : null;

    const avgFor = (deptKey: string): string => {
      const list = byDept[deptKey] || [];
      if (list.length === 0) return 'No data';
      const avg = list.reduce((a, b) => a + b, 0) / list.length;
      return `${avg.toFixed(1)} Hours`;
    };

    return {
      compliancePct,
      resolvedSampleCount: resolvedDurations.length,
      suppliesAvg: avgFor('Classroom Supplies'),
      itAvAvg: avgFor('IT / Audio-Visual Support'),
      housekeepingAvg: avgFor('Housekeeping'),
      facilitiesAvg: avgFor('Facilities / Maintenance'),
    };
  }, [tickets]);

  // 1. Most Problematic Rooms (merge static catalog with live ticket counts)
  const rankedRooms = useMemo(() => {
    const map = new Map<string, { roomNumber: string; building: string; totalIncidents: number; equipment: string[] }>();
    for (const r of rooms) {
      map.set(r.roomNumber.toLowerCase(), {
        roomNumber: r.roomNumber,
        building: r.building,
        totalIncidents: 0,
        equipment: r.equipment,
      });
    }
    for (const t of tickets) {
      const key = t.roomNumber.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.totalIncidents += 1;
      } else {
        map.set(key, {
          roomNumber: t.roomNumber,
          building: t.building,
          totalIncidents: 1,
          equipment: [t.category],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalIncidents - a.totalIncidents);
  }, [tickets, rooms]);

  // 2. Department Breakdown
  const departmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      counts[t.recommendedDepartment] = (counts[t.recommendedDepartment] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  // 3. Category Breakdown
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  // 4. Priority Distribution
  const priorityCounts = useMemo(() => {
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const t of tickets) {
      if (counts[t.priority] !== undefined) {
        counts[t.priority]++;
      }
    }
    return counts;
  }, [tickets]);

  return (
    <div className="space-y-6">
      {/* Analytics Top Banner */}
      <div className="p-5 bg-white rounded-lg border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Campus Infrastructure Analytics & SLA Performance
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aggregated dynamically across {tickets.length} tracked ticket(s) (4h SLA target).
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`font-semibold px-2.5 py-1 rounded border ${
                slaMetrics.compliancePct !== null
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-slate-600 bg-slate-50 border-slate-200'
              }`}
            >
              {slaMetrics.compliancePct !== null
                ? `Overall SLA Compliance: ${slaMetrics.compliancePct}% (${slaMetrics.resolvedSampleCount} resolved)`
                : 'Overall SLA Compliance: N/A (0 resolved timestamps)'}
            </span>
          </div>
        </div>
      </div>

      {/* 4 Average Resolution Time Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Classroom Supplies SLA</span>
            <Clock className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">{slaMetrics.suppliesAvg}</div>
          <p className="text-[11px] text-slate-500 mt-1">Measured podium restock time</p>
        </div>

        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>IT & AV Support SLA</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">{slaMetrics.itAvAvg}</div>
          <p className="text-[11px] text-slate-500 mt-1">Measured projector & AV triage</p>
        </div>

        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Housekeeping & Sanitation</span>
            <Clock className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">{slaMetrics.housekeepingAvg}</div>
          <p className="text-[11px] text-slate-500 mt-1">Measured custodial cleanup time</p>
        </div>

        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Facilities & Physical Plant</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">{slaMetrics.facilitiesAvg}</div>
          <p className="text-[11px] text-slate-500 mt-1">Measured furniture & HVAC repair</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Problematic Rooms */}
        <div className="p-5 bg-white rounded-lg border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Most Problematic Rooms (Ticket Volume)
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">Live Count</span>
          </div>

          <div className="space-y-3">
            {rankedRooms.slice(0, 6).map((r, i) => {
              const maxVal = Math.max(rankedRooms[0]?.totalIncidents || 1, 1);
              const pct = Math.round((r.totalIncidents / maxVal) * 100);

              return (
                <div key={r.roomNumber} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between font-medium">
                    <span className="text-slate-900 font-bold font-mono">
                      #{i + 1} {r.roomNumber}{' '}
                      <span className="text-slate-500 font-normal">({r.building})</span>
                    </span>
                    <span className="font-mono text-slate-700 font-bold tabular-nums">
                      {r.totalIncidents} ticket(s)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        i === 0
                          ? 'bg-rose-500'
                          : i === 1
                          ? 'bg-amber-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Tracked equipment: {r.equipment.slice(0, 2).join(', ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Most Reported Departments */}
        <div className="p-5 bg-white rounded-lg border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Building className="w-4 h-4 text-blue-600" />
              Workload by Department
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">Active Load</span>
          </div>

          <div className="space-y-3">
            {departmentCounts.map(([deptName, count]) => {
              const pct = Math.round((count / (tickets.length || 1)) * 100);

              return (
                <div key={deptName} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between font-medium">
                    <span className="text-slate-900 font-semibold">{deptName}</span>
                    <span className="font-mono text-slate-700 font-bold tabular-nums">
                      {count} tickets ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${Math.max(8, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Common Issue Categories */}
        <div className="p-5 bg-white rounded-lg border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-purple-600" />
              Common Issue Categories
            </h3>
          </div>

          <div className="space-y-3">
            {categoryCounts.map(([catName, count]) => {
              const pct = Math.round((count / (tickets.length || 1)) * 100);

              return (
                <div key={catName} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-900 font-medium">{catName}</span>
                    <span className="font-mono font-bold text-slate-700 tabular-nums">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-purple-600"
                      style={{ width: `${Math.max(6, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority Breakdown & Safety Impact */}
        <div className="p-5 bg-white rounded-lg border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              Priority Distribution & Urgency
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-md">
              <span className="font-semibold text-rose-900 block">Critical</span>
              <span className="text-xl font-bold font-mono text-rose-700 tabular-nums">
                {priorityCounts.Critical}
              </span>
              <span className="text-[10px] text-rose-700 block mt-0.5">Physical safety hazard</span>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
              <span className="font-semibold text-amber-900 block">High</span>
              <span className="text-xl font-bold font-mono text-amber-700 tabular-nums">
                {priorityCounts.High}
              </span>
              <span className="text-[10px] text-amber-700 block mt-0.5">Lecture interruption</span>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
              <span className="font-semibold text-blue-900 block">Medium</span>
              <span className="text-xl font-bold font-mono text-blue-700 tabular-nums">
                {priorityCounts.Medium}
              </span>
              <span className="text-[10px] text-blue-700 block mt-0.5">Standard maintenance</span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <span className="font-semibold text-slate-700 block">Low</span>
              <span className="text-xl font-bold font-mono text-slate-700 tabular-nums">
                {priorityCounts.Low}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">Cosmetic or supplies</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded text-slate-600 text-xs leading-relaxed">
            <strong className="text-slate-800">AI Priority Engine Note: </strong>
            Critical priorities are immediately routed with automated SMS simulation to department
            safety coordinators, bypassing ordinary triage queues.
          </div>
        </div>
      </div>
    </div>
  );
};
