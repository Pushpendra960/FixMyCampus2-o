import React, { useState, useMemo } from 'react';
import {
  Search,
  AlertCircle,
  Clock,
  CheckCircle,
  FileQuestion,
  ChevronRight,
  Layers,
  RefreshCw,
  Sheet,
  ArrowUpDown,
} from 'lucide-react';
import { BackendConnectionStatus, CampusTicket, TicketPriority } from '../types/campus';
import { BUILDINGS } from '../data/mockData';

interface DashboardViewProps {
  tickets: CampusTicket[];
  onSelectTicket: (ticket: CampusTicket) => void;
  onOpenReportModal: () => void;
  onSelectRoom: (roomNumber: string) => void;
  isLoading?: boolean;
  backendStatus?: BackendConnectionStatus;
  backendError?: string | null;
  onRetrySync?: () => void;
  onSwitchToDemo?: () => void;
  onOpenSheetsModal?: () => void;
}

const PRIORITY_WEIGHT: Record<TicketPriority, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function parseTimeMs(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return isNaN(ms) ? 0 : ms;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  tickets,
  onSelectTicket,
  onOpenReportModal,
  onSelectRoom,
  isLoading = false,
  backendStatus = 'demo',
  backendError = null,
  onRetrySync,
  onSwitchToDemo,
  onOpenSheetsModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'reportedAt' | 'priority' | 'status'>('reportedAt');

  // Derive unique categories, departments, and buildings present in current dataset + known defaults
  const filterOptions = useMemo(() => {
    const catSet = new Set<string>();
    const deptSet = new Set<string>();
    const bldgSet = new Set<string>(BUILDINGS);

    for (const t of tickets) {
      if (t.category) catSet.add(t.category);
      if (t.recommendedDepartment) deptSet.add(t.recommendedDepartment);
      if (t.building) bldgSet.add(t.building);
    }

    return {
      categories: Array.from(catSet).sort(),
      departments: Array.from(deptSet).sort(),
      buildings: Array.from(bldgSet),
    };
  }, [tickets]);

  // KPI Calculations
  const stats = useMemo(() => {
    const deptCounts: Record<string, number> = {};
    for (const t of tickets) {
      const dept = t.recommendedDepartment || 'General Administration';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    }

    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === 'Open').length,
      critical: tickets.filter((t) => t.priority === 'Critical').length,
      highPriority: tickets.filter((t) => t.priority === 'High' || t.priority === 'Critical').length,
      inProgress: tickets.filter((t) => t.status === 'In Progress').length,
      pendingVerification: tickets.filter((t) => t.status === 'Pending Verification').length,
      resolved: tickets.filter((t) => t.status === 'Resolved' || t.status === 'Closed').length,
      topDepartments: Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).slice(0, 4),
    };
  }, [tickets]);

  const resetAllFilters = () => {
    setSelectedStatus('all');
    setSelectedPriority('all');
    setSelectedCategory('all');
    setSelectedDepartment('all');
    setSelectedBuilding('all');
    setSearchQuery('');
  };

  const hasActiveFilters =
    selectedStatus !== 'all' ||
    selectedPriority !== 'all' ||
    selectedCategory !== 'all' ||
    selectedDepartment !== 'all' ||
    selectedBuilding !== 'all' ||
    searchQuery.trim() !== '';

  // Filtered & Sorted Tickets
  const filteredTickets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    const filtered = tickets.filter((t) => {
      const matchesSearch =
        !q ||
        (t.id || '').toLowerCase().includes(q) ||
        (t.roomNumber || '').toLowerCase().includes(q) ||
        (t.building || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.recommendedDepartment || '').toLowerCase().includes(q) ||
        (t.status || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.aiSummary || '').toLowerCase().includes(q) ||
        (t.facultyName || '').toLowerCase().includes(q) ||
        (t.assignedTo || '').toLowerCase().includes(q);

      const matchesStatus =
        selectedStatus === 'all' ||
        (selectedStatus === 'active'
          ? t.status !== 'Closed' && t.status !== 'Resolved'
          : selectedStatus === 'resolved_closed'
          ? t.status === 'Resolved' || t.status === 'Closed'
          : t.status === selectedStatus);

      const matchesPriority =
        selectedPriority === 'all' || t.priority === selectedPriority;

      const matchesCategory =
        selectedCategory === 'all' || t.category === selectedCategory;

      const matchesDepartment =
        selectedDepartment === 'all' || t.recommendedDepartment === selectedDepartment;

      const matchesBuilding =
        selectedBuilding === 'all' || t.building === selectedBuilding;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesCategory &&
        matchesDepartment &&
        matchesBuilding
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'priority') {
        const diff = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
        if (diff !== 0) return diff;
      } else if (sortBy === 'status') {
        const cmp = (a.status || '').localeCompare(b.status || '');
        if (cmp !== 0) return cmp;
      }
      const timeDiff = parseTimeMs(b.reportedAt) - parseTimeMs(a.reportedAt);
      if (timeDiff !== 0) return timeDiff;
      return (b.id || '').localeCompare(a.id || '');
    });
  }, [
    tickets,
    searchQuery,
    selectedStatus,
    selectedPriority,
    selectedCategory,
    selectedDepartment,
    selectedBuilding,
    sortBy,
  ]);

  return (
    <div className="space-y-6">
      {/* LIVE BACKEND ERROR BANNER (NEVER HIDDEN BEHIND SILENT MOCK DATA) */}
      {backendStatus === 'error' && backendError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-900">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">Google Sheets Sync Unavailable</span>
              <span className="text-rose-800">{backendError}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onRetrySync && (
              <button
                type="button"
                onClick={onRetrySync}
                className="px-3 py-1.5 bg-white hover:bg-rose-100 border border-rose-300 text-rose-900 font-semibold rounded flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Sync</span>
              </button>
            )}
            {onOpenSheetsModal && (
              <button
                type="button"
                onClick={onOpenSheetsModal}
                className="px-3 py-1.5 bg-white hover:bg-rose-100 border border-rose-300 text-rose-900 font-semibold rounded flex items-center gap-1.5"
              >
                <Sheet className="w-3.5 h-3.5" />
                <span>Configure Sheets</span>
              </button>
            )}
            {onSwitchToDemo && (
              <button
                type="button"
                onClick={onSwitchToDemo}
                className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white font-semibold rounded"
              >
                Use Demo Mode
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Total */}
        <div
          onClick={resetAllFilters}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            !hasActiveFilters
              ? 'border-blue-500 ring-2 ring-blue-100 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Total</span>
            <Layers className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {stats.total}
          </div>
          <span className="text-[11px] text-slate-500">
            {stats.highPriority} High/Critical
          </span>
        </div>

        {/* Open */}
        <div
          onClick={() => {
            setSelectedPriority('all');
            setSelectedStatus('Open');
          }}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedStatus === 'Open'
              ? 'border-blue-500 ring-2 ring-blue-100 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-blue-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Open</span>
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-blue-700 font-mono tabular-nums">
            {stats.open}
          </div>
          <span className="text-[11px] text-slate-500">Awaiting triage/tech</span>
        </div>

        {/* Critical */}
        <div
          onClick={() => {
            setSelectedStatus('all');
            setSelectedPriority(selectedPriority === 'Critical' ? 'all' : 'Critical');
          }}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedPriority === 'Critical'
              ? 'border-rose-500 ring-2 ring-rose-100 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-rose-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Critical</span>
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-600 font-mono tabular-nums">
            {stats.critical}
          </div>
          <span className="text-[11px] text-rose-700">Safety or lecture halt</span>
        </div>

        {/* In Progress */}
        <div
          onClick={() => {
            setSelectedPriority('all');
            setSelectedStatus('In Progress');
          }}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedStatus === 'In Progress'
              ? 'border-blue-500 ring-2 ring-blue-100 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-amber-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">In Progress</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-amber-700 font-mono tabular-nums">
            {stats.inProgress}
          </div>
          <span className="text-[11px] text-slate-500">Tech currently on site</span>
        </div>

        {/* Pending Verification */}
        <div
          onClick={() => {
            setSelectedPriority('all');
            setSelectedStatus('Pending Verification');
          }}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedStatus === 'Pending Verification'
              ? 'border-purple-500 ring-2 ring-purple-100 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-purple-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Verification</span>
            <FileQuestion className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-purple-700 font-mono tabular-nums">
            {stats.pendingVerification}
          </div>
          <span className="text-[11px] text-slate-500">Evidence under review</span>
        </div>

        {/* Resolved */}
        <div
          onClick={() => {
            setSelectedPriority('all');
            setSelectedStatus('resolved_closed');
          }}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedStatus === 'resolved_closed' || selectedStatus === 'Resolved'
              ? 'border-emerald-500 ring-2 ring-emerald-100 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-emerald-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Resolved</span>
            <CheckCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 font-mono tabular-nums">
            {stats.resolved}
          </div>
          <span className="text-[11px] text-slate-500">Verified &amp; closed</span>
        </div>
      </div>

      {/* DEPARTMENT WORKLOAD QUICK BAR */}
      {stats.topDepartments.length > 0 && (
        <div className="bg-white px-4 py-3 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-slate-600 uppercase tracking-wider text-[11px]">
            Department Load:
          </span>
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {stats.topDepartments.map(([dept, count]) => (
              <button
                key={dept}
                type="button"
                onClick={() =>
                  setSelectedDepartment(selectedDepartment === dept ? 'all' : dept)
                }
                className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                  selectedDepartment === dept
                    ? 'bg-blue-50 border-blue-400 text-blue-800 font-semibold'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{dept}</span>
                <span className="font-mono font-bold text-slate-900">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SEARCH AND FILTER BAR */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticket ID (e.g. FMC-1001), room, department, technician, or keywords..."
              className="w-full pl-9 pr-14 py-2 text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Filter dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <select
              aria-label="Filter by status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="active">All Active (Excl. Closed/Resolved)</option>
              <option value="Open">Open</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending Verification">Pending Verification</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
              <option value="resolved_closed">Resolved &amp; Closed</option>
              <option value="Needs Review">Needs Review</option>
            </select>

            {/* Priority Filter */}
            <select
              aria-label="Filter by priority"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>

            {/* Department Filter */}
            <select
              aria-label="Filter by department"
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Departments</option>
              {filterOptions.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {/* Category Filter */}
            <select
              aria-label="Filter by category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Categories</option>
              {filterOptions.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Building Filter */}
            <select
              aria-label="Filter by building"
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              className="px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Buildings</option>
              {filterOptions.buildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            {/* Sort By */}
            <div className="flex items-center gap-1 border border-slate-300 rounded-md px-2 py-1.5 bg-slate-50">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              <select
                aria-label="Sort tickets"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'reportedAt' | 'priority' | 'status')}
                className="text-xs font-medium bg-transparent text-slate-700 focus:outline-none"
              >
                <option value="reportedAt">Sort: Newest</option>
                <option value="priority">Sort: Priority</option>
                <option value="status">Sort: Status</option>
              </select>
            </div>
          </div>
        </div>

        {/* Filter Reset if any active */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
            <span>Active filters:</span>
            {selectedStatus !== 'all' && (
              <span className="font-semibold text-slate-800">Status: {selectedStatus}</span>
            )}
            {selectedPriority !== 'all' && (
              <span className="font-semibold text-slate-800">Priority: {selectedPriority}</span>
            )}
            {selectedDepartment !== 'all' && (
              <span className="font-semibold text-slate-800">Dept: {selectedDepartment}</span>
            )}
            {selectedCategory !== 'all' && (
              <span className="font-semibold text-slate-800">Category: {selectedCategory}</span>
            )}
            {selectedBuilding !== 'all' && (
              <span className="font-semibold text-slate-800">Building: {selectedBuilding}</span>
            )}
            {searchQuery && (
              <span className="font-semibold text-slate-800">Search: &quot;{searchQuery}&quot;</span>
            )}
            <button
              type="button"
              onClick={resetAllFilters}
              className="ml-auto text-blue-600 hover:text-blue-800 font-medium underline"
            >
              Reset all filters
            </button>
          </div>
        )}
      </div>

      {/* TICKETS HIGH-DENSITY TABLE */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Campus Issue Tickets</h3>
            <p className="text-xs text-slate-500">
              Showing <span className="font-mono tabular-nums">{filteredTickets.length}</span> of{' '}
              <span className="font-mono tabular-nums">{tickets.length}</span> incidents
            </p>
          </div>
          <div className="text-xs text-slate-500 hidden sm:flex items-center gap-2">
            <span>Click any row to view timeline, assign technician, or verify resolution.</span>
          </div>
        </div>

        {isLoading && tickets.length === 0 ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-12 bg-slate-100 rounded-md animate-pulse"
              />
            ))}
            <p className="text-center text-xs text-slate-500 pt-2">
              Loading live tickets from Google Sheets backend...
            </p>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-slate-800 mb-1">
              {tickets.length === 0
                ? 'No tickets recorded yet'
                : 'No matching tickets found'}
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              {tickets.length === 0
                ? 'Submit a new campus issue or configure your Google Sheets connection to load records.'
                : 'Try adjusting your search or filter criteria, or submit a new campus issue.'}
            </p>
            <div className="flex items-center justify-center gap-3">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Reset Filters
                </button>
              )}
              <button
                type="button"
                onClick={onOpenReportModal}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                Report New Issue
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-4">Ticket ID</th>
                  <th className="py-2.5 px-4">Location</th>
                  <th className="py-2.5 px-4">Category &amp; AI Summary</th>
                  <th className="py-2.5 px-4">Priority</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Assigned To</th>
                  <th className="py-2.5 px-4">Reported</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredTickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTicket(t)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                  >
                    {/* Ticket ID */}
                    <td className="py-3 px-4 font-mono font-bold text-blue-700 tabular-nums whitespace-nowrap">
                      {t.id}
                    </td>

                    {/* Location */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRoom(t.roomNumber);
                        }}
                        className="text-left hover:underline font-semibold text-slate-900"
                        title="View room maintenance history"
                      >
                        {t.roomNumber}
                      </button>
                      <div className="text-[11px] text-slate-500">{t.building}</div>
                    </td>

                    {/* Category & Summary */}
                    <td className="py-3 px-4 max-w-xs md:max-w-md">
                      <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                        <span>{t.category}</span>
                        <span className="text-slate-300">&middot;</span>
                        <span className="text-slate-500 text-[11px]">{t.recommendedDepartment}</span>
                      </div>
                      <div className="text-slate-900 truncate mt-0.5" title={t.aiSummary}>
                        {t.aiSummary}
                      </div>
                    </td>

                    {/* Priority */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            t.priority === 'Critical'
                              ? 'bg-rose-600'
                              : t.priority === 'High'
                              ? 'bg-amber-500'
                              : t.priority === 'Medium'
                              ? 'bg-blue-600'
                              : 'bg-slate-400'
                          }`}
                        />
                        <span
                          className={`font-semibold ${
                            t.priority === 'Critical'
                              ? 'text-rose-700'
                              : t.priority === 'High'
                              ? 'text-amber-800'
                              : 'text-slate-700'
                          }`}
                        >
                          {t.priority}
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          t.status === 'Open'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : t.status === 'In Progress'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : t.status === 'Pending Verification'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : t.status === 'Resolved' || t.status === 'Closed'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>

                    {/* Assigned To */}
                    <td className="py-3 px-4 whitespace-nowrap text-slate-600 text-[11px]">
                      {t.assignedTo ? (
                        <span className="font-medium text-slate-800">{t.assignedTo}</span>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>

                    {/* Reported At */}
                    <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums text-slate-500 text-[11px]">
                      {t.reportedAt}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTicket(t);
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors inline-flex items-center gap-1"
                      >
                        <span>Details</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
