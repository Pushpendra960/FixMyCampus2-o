import React from 'react';
import {
  LayoutDashboard,
  Ticket,
  History,
  BarChart2,
  Bell,
  Sheet,
  RotateCcw,
  Sparkles,
  Building,
  CheckCircle,
  AlertTriangle,
  GraduationCap,
} from 'lucide-react';
import { CampusTicket } from '../types/campus';
import { storageService } from '../services/storageService';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  tickets: CampusTicket[];
  onOpenReportModal: () => void;
  onOpenNotifications: () => void;
  onOpenSheetsModal: () => void;
  onResetData: () => void;
  notificationCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  tickets,
  onOpenReportModal,
  onOpenNotifications,
  onOpenSheetsModal,
  onResetData,
  notificationCount,
}) => {
  const openCount = tickets.filter((t) => t.status === 'Open').length;
  const criticalCount = tickets.filter((t) => t.priority === 'Critical').length;

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 min-h-[calc(100vh-65px)]">
      <div className="p-4 space-y-6">
        {/* Navigation Section */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 block mb-2">
            Campus Operations
          </span>

          <button
            onClick={() => onSelectTab('dashboard')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
              currentTab === 'dashboard'
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className="w-4 h-4 text-slate-500" />
              <span>Admin Dashboard</span>
            </div>
            {openCount > 0 && (
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                {openCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab('tickets')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
              currentTab === 'tickets'
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Ticket className="w-4 h-4 text-slate-500" />
              <span>All Tickets</span>
            </div>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {tickets.length}
            </span>
          </button>

          <button
            onClick={() => onSelectTab('room-history')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
              currentTab === 'room-history'
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-slate-500" />
              <span>Room History & Audit</span>
            </div>
          </button>

          <button
            onClick={() => onSelectTab('analytics')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
              currentTab === 'analytics'
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <BarChart2 className="w-4 h-4 text-slate-500" />
              <span>Analytics & SLA</span>
            </div>
          </button>

          <button
            onClick={onOpenNotifications}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Bell className="w-4 h-4 text-slate-500" />
              <span>Dispatch Queue</span>
            </div>
            {notificationCount > 0 && (
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                {notificationCount}
              </span>
            )}
          </button>

          <button
            onClick={onOpenSheetsModal}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Sheet className="w-4 h-4 text-emerald-600" />
              <span>Google Sheets Sync</span>
            </div>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                storageService.getBackendUrl()
                  ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                  : 'text-blue-700 bg-blue-50'
              }`}
            >
              {storageService.getBackendUrl() ? 'Live Sync' : 'Configure'}
            </span>
          </button>
        </div>

        {/* Priority Quick Triage Pill */}
        {criticalCount > 0 && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-rose-900">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>{criticalCount} Critical Ticket Active</span>
            </div>
            <p className="text-[11px] text-rose-700 leading-tight">
              Physical hazard or classroom halt requires priority dispatch.
            </p>
          </div>
        )}

        {/* AI Engine Badge */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>AI Triage Active</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-tight">
            Categorization, duplicate detection, and urgency assessment operating on Gemini 3.8 Flash.
          </p>
        </div>
      </div>

      {/* Sidebar Footer with Demo State Reset */}
      <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/50">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1 font-medium">
            <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
            College AI Hackathon
          </span>
          <span className="font-mono text-slate-400">v2.0</span>
        </div>

        <button
          onClick={onResetData}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
          title="Reset back to initial sample tickets (Projector, Markers, Broken Chair)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Sample Demo Data</span>
        </button>
      </div>
    </aside>
  );
};
