import React from 'react';
import { Plus, ShieldCheck, RefreshCw, Bell, Sheet } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenReportModal: () => void;
  onOpenNotifications: () => void;
  onOpenSheetsModal: () => void;
  onResetData: () => void;
  notificationCount: number;
  hasBackendUrl?: boolean;
  onRefreshLiveTickets?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  onOpenReportModal,
  onOpenNotifications,
  onOpenSheetsModal,
  onResetData,
  notificationCount,
  hasBackendUrl,
  onRefreshLiveTickets,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="flex items-center justify-between gap-8 px-6 py-3.5 max-w-[1600px] mx-auto">
        {/* Zone 1: Brand title wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
            F
          </div>
          <div className="flex flex-col">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSelectTab('dashboard');
              }}
              className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap hover:text-blue-600 transition-colors"
            >
              FixMyCampus 2.0
            </a>
            <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
              AI Campus Issue Triage System
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            onClick={() => onSelectTab('dashboard')}
            className={`whitespace-nowrap transition-colors py-1 border-b-2 text-sm ${
              currentTab === 'dashboard'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => onSelectTab('tickets')}
            className={`whitespace-nowrap transition-colors py-1 border-b-2 text-sm ${
              currentTab === 'tickets'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            All Tickets
          </button>
          <button
            onClick={() => onSelectTab('room-history')}
            className={`whitespace-nowrap transition-colors py-1 border-b-2 text-sm ${
              currentTab === 'room-history'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Room History
          </button>
          <button
            onClick={() => onSelectTab('analytics')}
            className={`whitespace-nowrap transition-colors py-1 border-b-2 text-sm ${
              currentTab === 'analytics'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Analytics & SLA
          </button>
          <button
            onClick={onOpenNotifications}
            className="whitespace-nowrap transition-colors py-1 border-b-2 border-transparent hover:text-slate-900 text-sm flex items-center gap-1.5"
          >
            <span>Dispatch Log</span>
            {notificationCount > 0 && (
              <span className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded">
                {notificationCount}
              </span>
            )}
          </button>
        </nav>

        {/* Zone 3: Primary Action and Utilities */}
        <div className="flex items-center gap-3 shrink-0">
          {hasBackendUrl ? (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200/80 rounded text-xs text-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold uppercase tracking-wider text-[10px]">SHEETS LIVE</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200/80 rounded text-xs text-amber-800">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              <span className="font-semibold uppercase tracking-wider text-[10px]">DEMO / LOCAL</span>
            </div>
          )}

          <button
            onClick={onOpenSheetsModal}
            title="Google Sheets & Apps Script Integration Spec"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Sheet className="w-4 h-4" />
          </button>

          {onRefreshLiveTickets ? (
            <button
              onClick={onRefreshLiveTickets}
              title="Refresh Live Tickets from Google Sheets"
              className="p-2 text-slate-600 hover:text-blue-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onResetData}
              title="Reset to Initial Hackathon Demo Tickets"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={onOpenReportModal}
            className="flex items-center gap-2 px-4 py-2 text-xs md:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Report Campus Issue</span>
          </button>
        </div>
      </div>
    </header>
  );
};
