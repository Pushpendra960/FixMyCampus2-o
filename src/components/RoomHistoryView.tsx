import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  History,
  Wrench,
  Monitor,
  Search,
  Repeat,
} from 'lucide-react';
import { CampusTicket, RoomRecord } from '../types/campus';
import { ROOM_MAINTENANCE_HISTORY } from '../data/mockData';

interface RoomHistoryViewProps {
  rooms: RoomRecord[];
  tickets: CampusTicket[];
  onSelectTicket: (ticket: CampusTicket) => void;
  onReportIssueForRoom: (roomNumber: string, building: string) => void;
  isBackendLive?: boolean;
  initialSelectedRoom?: string;
}

function parseTimeMs(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return isNaN(ms) ? 0 : ms;
}

export const RoomHistoryView: React.FC<RoomHistoryViewProps> = ({
  rooms,
  tickets,
  onSelectTicket,
  onReportIssueForRoom,
  isBackendLive = false,
  initialSelectedRoom,
}) => {
  // Derive rooms cleanly: in Live mode, strictly from actual tickets; in Demo mode, merge with demo room catalog
  const mergedRooms = useMemo(() => {
    const map = new Map<string, RoomRecord>();

    if (!isBackendLive) {
      for (const r of rooms) {
        map.set(r.roomNumber.toLowerCase(), { ...r, equipment: [...r.equipment] });
      }
    }

    for (const t of tickets) {
      const roomLabel = (t.roomNumber || 'Unspecified Room').trim();
      const key = roomLabel.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          roomNumber: roomLabel,
          building: t.building || 'Campus',
          roomType: 'Lecture Hall',
          capacity: 40,
          equipment: [t.category],
          totalIncidents: 0,
          activeTickets: [],
          lastMaintenance: t.reportedAt,
        });
      } else {
        const entry = map.get(key)!;
        if (t.category && !entry.equipment.includes(t.category)) {
          entry.equipment.push(t.category);
        }
      }
    }

    return Array.from(map.values())
      .map((r) => {
        const matching = tickets.filter(
          (t) => (t.roomNumber || '').trim().toLowerCase() === r.roomNumber.toLowerCase()
        );
        const openCount = matching.filter(
          (t) => t.status !== 'Closed' && t.status !== 'Resolved'
        ).length;
        const resolvedCount = matching.length - openCount;
        return {
          ...r,
          totalIncidents: matching.length,
          openCount,
          resolvedCount,
        };
      })
      .sort((a, b) => b.totalIncidents - a.totalIncidents || a.roomNumber.localeCompare(b.roomNumber));
  }, [rooms, tickets, isBackendLive]);

  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string>(
    initialSelectedRoom || mergedRooms[0]?.roomNumber || ''
  );
  const [selectedBuilding, setSelectedBuilding] = useState<string>('ALL');
  const [roomFilterSearch, setRoomFilterSearch] = useState('');

  useEffect(() => {
    if (initialSelectedRoom) {
      setSelectedBuilding('ALL');
      setRoomFilterSearch('');
      const match = mergedRooms.find(
        (r) => r.roomNumber.toLowerCase() === initialSelectedRoom.toLowerCase()
      );
      setSelectedRoomNumber(match ? match.roomNumber : initialSelectedRoom);
    }
  }, [initialSelectedRoom, mergedRooms]);

  const availableBuildings = useMemo(() => {
    const set = new Set<string>();
    for (const r of mergedRooms) {
      if (r.building) set.add(r.building);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mergedRooms]);

  const filteredRoomList = useMemo(() => {
    const q = roomFilterSearch.trim().toLowerCase();
    return mergedRooms.filter((r) => {
      const matchesBuilding = selectedBuilding === 'ALL' || r.building === selectedBuilding;
      const matchesSearch =
        !q ||
        r.roomNumber.toLowerCase().includes(q) ||
        r.building.toLowerCase().includes(q);
      return matchesBuilding && matchesSearch;
    });
  }, [mergedRooms, selectedBuilding, roomFilterSearch]);

  useEffect(() => {
    if (filteredRoomList.length === 0) {
      return;
    }
    const stillVisible = filteredRoomList.some((r) => r.roomNumber === selectedRoomNumber);
    if (!stillVisible) {
      setSelectedRoomNumber(filteredRoomList[0].roomNumber);
    }
  }, [filteredRoomList, selectedRoomNumber]);

  const selectedRoom =
    filteredRoomList.find((r) => r.roomNumber === selectedRoomNumber) ||
    mergedRooms.find((r) => r.roomNumber === selectedRoomNumber) ||
    mergedRooms[0];

  // Deduplicated and chronologically sorted room tickets
  const roomTickets = useMemo(() => {
    if (!selectedRoom) return [];
    const seen = new Set<string>();
    const list: CampusTicket[] = [];
    for (const t of tickets) {
      if (
        (t.roomNumber || '').trim().toLowerCase() === selectedRoom.roomNumber.toLowerCase() &&
        !seen.has(t.id)
      ) {
        seen.add(t.id);
        list.push(t);
      }
    }
    return list.sort((a, b) => parseTimeMs(b.reportedAt) - parseTimeMs(a.reportedAt));
  }, [tickets, selectedRoom]);

  const activeRoomTickets = roomTickets.filter(
    (t) => t.status !== 'Closed' && t.status !== 'Resolved'
  );

  const recurringCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of roomTickets) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);
  }, [roomTickets]);

  const demoArchiveEntries =
    !isBackendLive && selectedRoom
      ? ROOM_MAINTENANCE_HISTORY[selectedRoom.roomNumber] || []
      : [];

  if (!selectedRoom) {
    return (
      <div className="p-10 bg-white rounded-lg border border-slate-200 text-center space-y-2">
        <History className="w-8 h-8 text-slate-300 mx-auto" />
        <h3 className="text-sm font-semibold text-slate-800">No Room History Available Yet</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Rooms appear here automatically as tickets are logged for campus buildings and classrooms.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            Room Maintenance History &amp; Recurring Issue Tracking
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isBackendLive
              ? 'Aggregated directly from live Google Sheets ticket history across campus rooms.'
              : 'Audit projector, chair, AC, electrical, and supply issues across campus spaces.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onReportIssueForRoom(selectedRoom.roomNumber, selectedRoom.building)
          }
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Report Problem in {selectedRoom.roomNumber}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Room Directory & Selector */}
        <div className="space-y-3 bg-white p-4 rounded-lg border border-slate-200 lg:col-span-1">
          <div className="space-y-2">
            <select
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              aria-label="Filter by Building"
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All Campus Buildings ({availableBuildings.length})</option>
              {availableBuildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={roomFilterSearch}
                onChange={(e) => setRoomFilterSearch(e.target.value)}
                placeholder="Filter rooms..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {filteredRoomList.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No rooms match the current building/search filter.
              </p>
            ) : (
              filteredRoomList.map((room) => (
                <button
                  key={room.roomNumber}
                  type="button"
                  onClick={() => setSelectedRoomNumber(room.roomNumber)}
                  className={`w-full text-left p-2.5 rounded-md transition-colors flex items-center justify-between ${
                    selectedRoom.roomNumber === room.roomNumber
                      ? 'bg-blue-50/80 border border-blue-300 text-blue-900 font-bold'
                      : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                  }`}
                >
                  <div>
                    <div className="text-xs font-mono">{room.roomNumber}</div>
                    <div className="text-[11px] text-slate-500 font-normal">
                      {room.building} &middot; {room.totalIncidents} total
                    </div>
                  </div>
                  {room.openCount > 0 ? (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                      {room.openCount} active
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-600 font-medium">Clear</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Detailed Room Dossier & History */}
        <div className="space-y-6 lg:col-span-3">
          {/* Room Profile Card */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold font-mono text-slate-900">
                    {selectedRoom.roomNumber}
                  </h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                    {selectedRoom.roomType}
                  </span>
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                  <Building2 className="w-3.5 h-3.5" />
                  {selectedRoom.building}
                  {roomTickets[0]?.reportedAt && (
                    <span>
                      {' '}
                      &middot; Most recent ticket:{' '}
                      <span className="font-mono">{roomTickets[0].reportedAt}</span>
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-4 text-right">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase">Open</span>
                  <span className="font-mono text-base font-bold text-amber-700 tabular-nums">
                    {selectedRoom.openCount}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase">Resolved</span>
                  <span className="font-mono text-base font-bold text-emerald-700 tabular-nums">
                    {selectedRoom.resolvedCount}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase">Total</span>
                  <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                    {selectedRoom.totalIncidents}
                  </span>
                </div>
              </div>
            </div>

            {/* Recurring Patterns */}
            {recurringCategories.length > 0 && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-md flex flex-wrap items-center gap-2 text-xs text-amber-900">
                <Repeat className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-semibold">Recurring Issues Detected:</span>
                {recurringCategories.map(([cat, count]) => (
                  <span
                    key={cat}
                    className="px-2 py-0.5 bg-white border border-amber-300 rounded font-medium text-[11px]"
                  >
                    {cat} ({count}x)
                  </span>
                ))}
              </div>
            )}

            {/* Tracked Categories / Equipment */}
            <div>
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-blue-600" />
                {isBackendLive ? 'Reported Issue Domains' : 'Monitored Classroom Equipment'}
              </span>
              <div className="flex flex-wrap gap-2">
                {selectedRoom.equipment.map((item) => (
                  <span
                    key={item}
                    className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-slate-700 font-medium"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ACTIVE TICKETS IN THIS ROOM */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Current Active Complaints ({activeRoomTickets.length})
              </h4>
            </div>

            {activeRoomTickets.length === 0 ? (
              <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>
                  No pending active complaints for {selectedRoom.roomNumber}. All reported issues are currently resolved.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {activeRoomTickets.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onSelectTicket(t)}
                    className="p-3 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-lg cursor-pointer transition-colors flex items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-blue-700">{t.id}</span>
                        <span className="text-xs font-semibold text-slate-800">{t.category}</span>
                        <span className="text-[11px] font-bold text-amber-700">[{t.priority}]</span>
                      </div>
                      <p className="text-xs text-slate-600">{t.aiSummary}</p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-semibold text-slate-800 block">{t.status}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{t.reportedAt}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CHRONOLOGICAL TICKET & MAINTENANCE LOG */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-slate-500" />
              Chronological Ticket History ({roomTickets.length})
            </h4>

            {roomTickets.length === 0 && demoArchiveEntries.length === 0 ? (
              <p className="text-xs text-slate-500">
                No historical tickets recorded for {selectedRoom.roomNumber} yet.
              </p>
            ) : (
              <div className="space-y-3 border-l-2 border-slate-200 ml-2 pl-4">
                {roomTickets.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onSelectTicket(t)}
                    className="space-y-1 text-xs p-2 rounded hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-blue-700">{t.id}</span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-mono font-bold text-slate-700 tabular-nums">
                        {t.reportedAt}
                      </span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-semibold text-slate-900">{t.category}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                        {t.status}
                      </span>
                      {t.timeline.length > 1 && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {t.timeline.length} audit events
                        </span>
                      )}
                      {t.evidenceRecords && t.evidenceRecords.length > 0 && (
                        <span className="text-[10px] text-emerald-700 font-mono">
                          {t.evidenceRecords.length} evidence
                        </span>
                      )}
                    </div>
                    <p className="text-slate-800 font-medium">{t.aiSummary}</p>
                    {t.resolution?.notes && (
                      <p className="text-slate-500 text-[11px] italic">
                        Resolution: {t.resolution.notes}
                      </p>
                    )}
                  </div>
                ))}

                {demoArchiveEntries.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Demo Semester Archive
                    </span>
                    {demoArchiveEntries.map((item, idx) => (
                      <div key={`archive-${idx}`} className="space-y-1 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-700 tabular-nums">
                            {item.date}
                          </span>
                          <span className="text-slate-400">&middot;</span>
                          <span className="font-semibold text-slate-900">{item.category}</span>
                        </div>
                        <p className="text-slate-800 font-medium">{item.issue}</p>
                        <p className="text-slate-500 text-[11px] italic">
                          Action taken: {item.resolution}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
