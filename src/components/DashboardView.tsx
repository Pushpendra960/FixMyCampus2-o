import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  AlertCircle,
  Clock,
  CheckCircle,
  FileQuestion,
  ChevronRight,
  Shield,
  Layers,
  ArrowUpDown,
  Building,
} from 'lucide-react';
import { CampusTicket, IssueCategory, TicketPriority, TicketStatus } from '../types/campus';
import { BUILDINGS } from '../data/mockData';

interface DashboardViewProps {
  tickets: CampusTicket[];
  onSelectTicket: (ticket: CampusTicket) => void;
  onOpenReportModal: () => void;
  onSelectRoom: (roomNumber: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  tickets,
  onSelectTicket,
  onOpenReportModal,
  onSelectRoom,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'reportedAt' | 'priority' | 'status'>('reportedAt');

  // KPI Calculations
  const stats = useMemo(() => {
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === 'Open').length,
      critical: tickets.filter((t) => t.priority === 'Critical').length,
      inProgress: tickets.filter((t) => t.status === 'In Progress').length,
      pendingVerification: tickets.filter((t) => t.status === 'Pending Verification').length,
      resolved: tickets.filter((t) => t.status === 'Resolved' || t.status === 'Closed').length,
    };
  }, [tickets]);

  // Filtered & Sorted Tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.id.toLowerCase().includes(q) ||
        t.roomNumber.toLowerCase().includes(q) ||
        t.building.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.recommendedDepartment.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.facultyName.toLowerCase().includes(q);

      const matchesStatus =
        selectedStatus === 'all' ||
        (selectedStatus === 'active'
          ? t.status !== 'Closed' && t.status !== 'Resolved'
          : t.status === selectedStatus);

      const matchesPriority =
        selectedPriority === 'all' || t.priority === selectedPriority;

      const matchesCategory =
        selectedCategory === 'all' || t.category === selectedCategory;

      const matchesBuilding =
        selectedBuilding === 'all' || t.building === selectedBuilding;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesCategory &&
        matchesBuilding
      );
    });
  }, [
    tickets,
    searchQuery,
    selectedStatus,
    selectedPriority,
    selectedCategory,
    selectedBuilding,
  ]);

  return (
    <div className="space-y-6">
      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Total */}
        <div
          onClick={() => setSelectedStatus('all')}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedStatus === 'all'
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
          <span className="text-[11px] text-slate-500">All campus tickets</span>
        </div>

        {/* Open */}
        <div
          onClick={() => setSelectedStatus('Open')}
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
          onClick={() => setSelectedPriority('Critical')}
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
          onClick={() => setSelectedStatus('In Progress')}
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
          onClick={() => setSelectedStatus('Pending Verification')}
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
          onClick={() => setSelectedStatus('Resolved')}
          className={`p-4 bg-white rounded-lg border cursor-pointer transition-all ${
            selectedStatus === 'Resolved'
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
          <span className="text-[11px] text-slate-500">Verified & closed</span>
        </div>
      </div>

      {/* SEARCH AND FILTER BAR */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticket ID (e.g. FMC-1001), room, department, category, or keywords..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
            {searchQuery && (
              <button
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
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="active">All Active (Excl. Closed)</option>
              <option value="Open">Open</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending Verification">Pending Verification</option>
              <option value="Resolved">Resolved</option>
              <option value="Needs Review">Needs Review</option>
            </select>

            {/* Priority Filter */}
            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>

            {/* Building Filter */}
            <select
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-slate-700"
            >
              <option value="all">All Buildings</option>
              {BUILDINGS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filter Reset if any active */}
        {(selectedStatus !== 'all' ||
          selectedPriority !== 'all' ||
          selectedCategory !== 'all' ||
          selectedBuilding !== 'all' ||
          searchQuery) && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
            <span>Active filters:</span>
            {selectedStatus !== 'all' && (
              <span className="font-semibold text-slate-800">Status: {selectedStatus}</span>
            )}
            {selectedPriority !== 'all' && (
              <span className="font-semibold text-slate-800">Priority: {selectedPriority}</span>
            )}
            {selectedBuilding !== 'all' && (
              <span className="font-semibold text-slate-800">Building: {selectedBuilding}</span>
            )}
            {searchQuery && (
              <span className="font-semibold text-slate-800">Search: &quot;{searchQuery}&quot;</span>
            )}
            <button
              onClick={() => {
                setSelectedStatus('all');
                setSelectedPriority('all');
                setSelectedCategory('all');
                setSelectedBuilding('all');
                setSearchQuery('');
              }}
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
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>Tip: Click any row to view timeline, assign technician, or verify resolution.</span>
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-slate-800 mb-1">No matching tickets found</h4>
            <p className="text-xs text-slate-500 mb-4">
              Try adjusting your search criteria or report a new campus issue.
            </p>
            <button
              onClick={onOpenReportModal}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Report New Issue
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-4">Ticket ID</th>
                  <th className="py-2.5 px-4">Location</th>
                  <th className="py-2.5 px-4">Category & AI Summary</th>
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
                      <div className="font-semibold text-slate-900">{t.roomNumber}</div>
                      <div className="text-[11px] text-slate-500">{t.building}</div>
                    </td>

                    {/* Category & Summary */}
                    <td className="py-3 px-4 max-w-xs md:max-w-md">
                      <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                        <span>{t.category}</span>
                        <span className="text-slate-300">·</span>
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
