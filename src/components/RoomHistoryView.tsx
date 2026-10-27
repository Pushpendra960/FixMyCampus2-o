import React, { useState } from 'react';
import {
  Building2,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  History,
  Wrench,
  Monitor,
  Search,
} from 'lucide-react';
import { CampusTicket, RoomRecord } from '../types/campus';
import { ROOM_MAINTENANCE_HISTORY } from '../data/mockData';

interface RoomHistoryViewProps {
  rooms: RoomRecord[];
  tickets: CampusTicket[];
  onSelectTicket: (ticket: CampusTicket) => void;
  onReportIssueForRoom: (roomNumber: string, building: string) => void;
}

export const RoomHistoryView: React.FC<RoomHistoryViewProps> = ({
  rooms,
  tickets,
  onSelectTicket,
  onReportIssueForRoom,
}) => {
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string>(
    rooms[0]?.roomNumber || 'Room 302'
  );
  const [roomFilterSearch, setRoomFilterSearch] = useState('');

  const selectedRoom =
    rooms.find((r) => r.roomNumber === selectedRoomNumber) || rooms[0];

  const filteredRoomList = rooms.filter(
    (r) =>
      r.roomNumber.toLowerCase().includes(roomFilterSearch.toLowerCase()) ||
      r.building.toLowerCase().includes(roomFilterSearch.toLowerCase())
  );

  const roomTickets = tickets.filter(
    (t) => t.roomNumber.toLowerCase() === selectedRoom.roomNumber.toLowerCase()
  );

  const activeRoomTickets = roomTickets.filter(
    (t) => t.status !== 'Closed' && t.status !== 'Resolved'
  );

  const pastRoomHistory =
    ROOM_MAINTENANCE_HISTORY[selectedRoom.roomNumber] || [
      {
        date: '2026-08-10',
        issue: 'Routine semester start classroom inspection',
        resolution: 'Verified all AV components and whiteboard trays.',
        category: 'Facilities/Maintenance',
      },
    ];

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            Room Maintenance History & Recurring Issue Tracking
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit historical projector, chair, AC, electrical, and supply issues across campus spaces.
          </p>
        </div>
        <button
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

          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {filteredRoomList.map((room) => {
              const activeCount = tickets.filter(
                (t) =>
                  t.roomNumber.toLowerCase() === room.roomNumber.toLowerCase() &&
                  t.status !== 'Closed' &&
                  t.status !== 'Resolved'
              ).length;

              return (
                <button
                  key={room.roomNumber}
                  onClick={() => setSelectedRoomNumber(room.roomNumber)}
                  className={`w-full text-left p-2.5 rounded-md transition-colors flex items-center justify-between ${
                    selectedRoomNumber === room.roomNumber
                      ? 'bg-blue-50/80 border border-blue-300 text-blue-900 font-bold'
                      : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                  }`}
                >
                  <div>
                    <div className="text-xs font-mono">{room.roomNumber}</div>
                    <div className="text-[11px] text-slate-500 font-normal">{room.building}</div>
                  </div>
                  {activeCount > 0 ? (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                      {activeCount} active
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-600 font-medium">Clear</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Detailed Room Dossier & History */}
        <div className="space-y-6 lg:col-span-3">
          {/* Room Profile Card */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
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
                  {selectedRoom.building} · Capacity:{' '}
                  <span className="font-mono tabular-nums">{selectedRoom.capacity} seats</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block uppercase">Semester Incidents</span>
                  <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {selectedRoom.totalIncidents} Total
                  </span>
                </div>
              </div>
            </div>

            {/* Equipment Inventory */}
            <div>
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-blue-600" />
                Monitored Classroom Equipment
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
                <span>No pending active complaints for {selectedRoom.roomNumber}. All reported issues are currently resolved.</span>
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

          {/* CHRONOLOGICAL MAINTENANCE LOG */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-slate-500" />
              Chronological Issue History & Recurring Problem Audit
            </h4>

            <div className="space-y-3 border-l-2 border-slate-200 ml-2 pl-4">
              {pastRoomHistory.map((item, idx) => (
                <div key={idx} className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-700 tabular-nums">
                      {item.date}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-slate-900">{item.category}</span>
                  </div>
                  <p className="text-slate-800 font-medium">{item.issue}</p>
                  <p className="text-slate-500 text-[11px] italic">
                    Action taken: {item.resolution}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
