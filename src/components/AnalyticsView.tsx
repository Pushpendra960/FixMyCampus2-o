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
  // 1. Most Problematic Rooms
  const rankedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => b.totalIncidents - a.totalIncidents);
  }, [rooms]);

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
              Live intelligence aggregated across academic halls, labs, and faculty spaces.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
              Overall SLA Compliance: 94.8%
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
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">2.1 Hours</div>
          <p className="text-[11px] text-slate-500 mt-1">Average podium restock dispatch</p>
        </div>

        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>IT & AV Support SLA</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">4.2 Hours</div>
          <p className="text-[11px] text-slate-500 mt-1">Projector & audio triage time</p>
        </div>

        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Plumbing & Sanitation</span>
            <Clock className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">3.5 Hours</div>
          <p className="text-[11px] text-slate-500 mt-1">Leak isolation & fixture repair</p>
        </div>

        <div className="p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Facilities & Physical Plant</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">12.5 Hours</div>
          <p className="text-[11px] text-slate-500 mt-1">Furniture & HVAC work orders</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Problematic Rooms */}
        <div className="p-5 bg-white rounded-lg border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Most Problematic Rooms (Semester Incidents)
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">Ranked</span>
          </div>

          <div className="space-y-3">
            {rankedRooms.slice(0, 6).map((r, i) => {
              const maxVal = rankedRooms[0]?.totalIncidents || 10;
              const pct = Math.round((r.totalIncidents / maxVal) * 100);

              return (
                <div key={r.roomNumber} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between font-medium">
                    <span className="text-slate-900 font-bold font-mono">
                      #{i + 1} {r.roomNumber}{' '}
                      <span className="text-slate-500 font-normal">({r.building})</span>
                    </span>
                    <span className="font-mono text-slate-700 font-bold tabular-nums">
                      {r.totalIncidents} incidents
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
                    Primary recurring hardware: {r.equipment.slice(0, 2).join(', ')}
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
