import React, { useState, useId } from 'react';
import {
  X,
  Clock,
  MapPin,
  Building2,
  AlertCircle,
  CheckCircle2,
  Upload,
  User,
  Shield,
  Send,
  ThumbsUp,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { CampusTicket, ResolutionEvidence, TicketStatus } from '../types/campus';
import { DEPARTMENTS } from '../data/mockData';

interface TicketDetailModalProps {
  ticket: CampusTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTicket: (updated: CampusTicket) => void;
  onDispatchNotification?: (ticketId: string, role: string, subject: string, body: string) => void;
}

const STATUS_OPTIONS: TicketStatus[] = [
  'Open',
  'Assigned',
  'In Progress',
  'Pending Verification',
  'Resolved',
  'Closed',
  'Needs Review',
];

const TECHNICIANS = [
  'Leo Ramirez (Senior AV Tech)',
  'Marcus Vance (Facilities Lead)',
  'Elena Rostova (Supplies Coordinator)',
  'Carlos Mendez (Master Plumber)',
  'Kofi Mensah (Lead Electrician)',
  'Derrick Powell (HVAC Specialist)',
  'Amina Diallo (Custodial Inspector)',
];

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  isOpen,
  onClose,
  onUpdateTicket,
}) => {
  const evidenceInputId = useId();
  if (!isOpen || !ticket) return null;

  const [currentStatus, setCurrentStatus] = useState<TicketStatus>(ticket.status);
  const [assignedTechnician, setAssignedTechnician] = useState<string>(ticket.assignedTo || '');
  const [timelineNote, setTimelineNote] = useState('');

  // Resolution workflow states
  const [resolutionNotes, setResolutionNotes] = useState(ticket.resolution?.notes || '');
  const [resolvedBy, setResolvedBy] = useState(
    ticket.resolution?.resolvedBy || ticket.assignedTo || 'Lead Technician'
  );
  const [evidencePhotoUrl, setEvidencePhotoUrl] = useState<string | undefined>(
    ticket.resolution?.photoUrl
  );
  const [evidenceFileName, setEvidenceFileName] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);

  const handleEvidenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEvidenceFileName(file.name);
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        setEvidencePhotoUrl(loadEvt.target?.result as string);
        setCloseError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStatusChange = (newStatus: TicketStatus) => {
    setCloseError(null);

    // ENFORCE RULE: Do not close tickets when required evidence is missing.
    if (newStatus === 'Closed' || newStatus === 'Resolved') {
      const hasPhotoEvidence = !!evidencePhotoUrl || !!ticket.resolution?.photoUrl;
      const hasNote = (resolutionNotes.trim().length > 0) || !!ticket.resolution?.notes;

      if (!hasNote) {
        setCloseError(
          'Mandatory resolution note is missing. Please document the technician fix details before setting status to Resolved or Closed.'
        );
        return;
      }

      if (!hasPhotoEvidence) {
        setCloseError(
          'Mandatory resolution evidence upload is missing. University policy requires photo verification of repaired equipment/stocked supplies before closure.'
        );
        return;
      }
    }

    const nowStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const updatedResolution: ResolutionEvidence = {
      resolvedAt: ticket.resolution?.resolvedAt || nowStr,
      resolvedBy: resolvedBy || 'Technician',
      notes: resolutionNotes || ticket.resolution?.notes || 'Work completed per protocol.',
      photoUrl: evidencePhotoUrl || ticket.resolution?.photoUrl,
      verifiedAt: newStatus === 'Closed' ? nowStr : ticket.resolution?.verifiedAt,
      verifiedBy: newStatus === 'Closed' ? 'Department Admin' : ticket.resolution?.verifiedBy,
    };

    const newTimeline = [
      ...ticket.timeline,
      {
        id: `evt-${Date.now()}`,
        timestamp: nowStr,
        action: `Status transitioned to ${newStatus}`,
        actor: 'Admin / Coordinator',
        notes: resolutionNotes ? `Resolution note: ${resolutionNotes}` : undefined,
      },
    ];

    const updated: CampusTicket = {
      ...ticket,
      status: newStatus,
      assignedTo: assignedTechnician || ticket.assignedTo,
      timeline: newTimeline,
      resolution: newStatus === 'Resolved' || newStatus === 'Closed' ? updatedResolution : ticket.resolution,
    };

    setCurrentStatus(newStatus);
    onUpdateTicket(updated);
  };

  const handleAssignTechnician = (tech: string) => {
    setAssignedTechnician(tech);
    const nowStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const newTimeline = [
      ...ticket.timeline,
      {
        id: `evt-${Date.now()}`,
        timestamp: nowStr,
        action: `Assigned to ${tech}`,
        actor: 'Department Dispatcher',
      },
    ];

    const updated: CampusTicket = {
      ...ticket,
      assignedTo: tech,
      status: ticket.status === 'Open' ? 'Assigned' : ticket.status,
      timeline: newTimeline,
    };

    setCurrentStatus(updated.status);
    onUpdateTicket(updated);
  };

  const handleAddTimelineNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!timelineNote.trim()) return;

    const nowStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const newTimeline = [
      ...ticket.timeline,
      {
        id: `evt-${Date.now()}`,
        timestamp: nowStr,
        action: 'Operational Note Added',
        actor: 'Dispatch Coordinator',
        notes: timelineNote.trim(),
      },
    ];

    const updated: CampusTicket = {
      ...ticket,
      timeline: newTimeline,
    };

    setTimelineNote('');
    onUpdateTicket(updated);
  };

  const handleUpvote = () => {
    const updated: CampusTicket = {
      ...ticket,
      upvotes: (ticket.upvotes || 0) + 1,
    };
    onUpdateTicket(updated);
  };

  const dept = DEPARTMENTS[ticket.recommendedDepartment] || DEPARTMENTS['Campus Operations & Safety'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl my-8 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-200">
              {ticket.id}
            </span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${
                ticket.priority === 'Critical'
                  ? 'bg-rose-100 text-rose-800'
                  : ticket.priority === 'High'
                  ? 'bg-amber-100 text-amber-800'
                  : ticket.priority === 'Medium'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {ticket.priority} Priority
            </span>
            <span className="text-xs font-medium text-slate-500">
              Reported: <span className="font-mono tabular-nums">{ticket.reportedAt}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleUpvote}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200/70 rounded transition-colors"
              title="Acknowledge / Upvote this issue"
            >
              <ThumbsUp className="w-3.5 h-3.5 text-blue-600" />
              <span>{ticket.upvotes || 1} Impacted</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body Grid */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 max-h-[75vh] overflow-y-auto">
          {/* Main 2-column detail */}
          <div className="lg:col-span-2 space-y-5">
            {/* AI Summary Banner */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
                AI Incident Summary
              </span>
              <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                {ticket.aiSummary}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-800">Urgency Rationale: </span>
                {ticket.urgencyReason}
              </p>
            </div>

            {/* Description & Photo */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Full Problem Description
              </h4>
              <p className="text-sm text-slate-800 bg-white p-3.5 border border-slate-200 rounded-lg whitespace-pre-line leading-relaxed">
                {ticket.description}
              </p>

              {ticket.photoUrl && (
                <div className="mt-3">
                  <span className="text-xs font-semibold text-slate-500 block mb-1">
                    Attached Photo Evidence:
                  </span>
                  <div className="w-48 h-36 rounded-lg overflow-hidden border border-slate-200">
                    <img
                      src={ticket.photoUrl}
                      alt="Reported problem"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* RESOLUTION SECTION & EVIDENCE WORKFLOW */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Resolution & Evidence Verification
                </h4>
                {ticket.resolution && (
                  <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Resolved {ticket.resolution.resolvedAt}
                  </span>
                )}
              </div>

              {closeError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Closure Blocked: </span>
                    {closeError}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    Resolved By (Technician / Faculty)
                  </label>
                  <input
                    type="text"
                    value={resolvedBy}
                    onChange={(e) => setResolvedBy(e.target.value)}
                    placeholder="e.g. Leo Ramirez"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    Photo Evidence (Required to Close)
                  </label>
                  <label
                    htmlFor={evidenceInputId}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-dashed border-slate-300 rounded cursor-pointer text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      {evidencePhotoUrl || ticket.resolution?.photoUrl
                        ? 'Evidence Photo Uploaded ✓'
                        : 'Upload Fix Proof Photo'}
                    </span>
                  </label>
                  <input
                    id={evidenceInputId}
                    type="file"
                    accept="image/*"
                    onChange={handleEvidenceUpload}
                    className="hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-600 font-medium mb-1">
                  Resolution Notes (Required to Close)
                </label>
                <textarea
                  rows={2}
                  value={resolutionNotes}
                  onChange={(e) => {
                    setResolutionNotes(e.target.value);
                    setCloseError(null);
                  }}
                  placeholder="Detail parts replaced, tests conducted, or supplies delivered..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {(evidencePhotoUrl || ticket.resolution?.photoUrl) && (
                <div className="pt-1">
                  <span className="text-[11px] text-slate-500 block mb-1">Attached Resolution Evidence:</span>
                  <div className="w-32 h-24 rounded border border-slate-200 overflow-hidden">
                    <img
                      src={evidencePhotoUrl || ticket.resolution?.photoUrl}
                      alt="Resolution verification proof"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Audit Timeline */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Audit Trail & Status Progression
              </h4>
              <div className="space-y-2 border-l-2 border-slate-200 ml-2 pl-4 py-1">
                {ticket.timeline.map((evt) => (
                  <div key={evt.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{evt.action}</span>
                      <span className="text-slate-400 font-mono text-[10px] tabular-nums">
                        {evt.timestamp}
                      </span>
                    </div>
                    <span className="text-slate-500 block">by {evt.actor}</span>
                    {evt.notes && <p className="text-slate-600 mt-0.5 italic">{evt.notes}</p>}
                  </div>
                ))}
              </div>

              {/* Add Note Form */}
              <form onSubmit={handleAddTimelineNote} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={timelineNote}
                  onChange={(e) => setTimelineNote(e.target.value)}
                  placeholder="Add operational update or technician dispatch note..."
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={!timelineNote.trim()}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 rounded-md transition-colors flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Log Note</span>
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: Routing & Dispatch Info */}
          <div className="space-y-5">
            {/* Status Selector */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Update Status
              </label>
              <select
                value={currentStatus}
                onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500"
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">
                *Transition to &apos;Resolved&apos; or &apos;Closed&apos; requires photo evidence and notes.
              </p>
            </div>

            {/* Location & Reporter Info */}
            <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3 text-xs">
              <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Incident Context
              </h5>

              <div>
                <span className="text-slate-500 block">Location</span>
                <span className="font-semibold text-slate-900 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {ticket.building} · <span className="font-mono">{ticket.roomNumber}</span>
                </span>
              </div>

              <div>
                <span className="text-slate-500 block">Category</span>
                <span className="font-semibold text-slate-900">{ticket.category}</span>
              </div>

              <div>
                <span className="text-slate-500 block">Faculty Reporter</span>
                {ticket.isAnonymous ? (
                  <span className="font-medium text-emerald-800 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-emerald-600" />
                    Anonymous Faculty (Identity Concealed)
                  </span>
                ) : (
                  <span className="font-semibold text-slate-900 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    {ticket.facultyName} ({ticket.facultyEmail || 'email on file'})
                  </span>
                )}
              </div>
            </div>

            {/* Department Routing */}
            <div className="p-4 bg-blue-50/50 border border-blue-200 rounded-lg space-y-3 text-xs">
              <h5 className="font-bold text-blue-900 uppercase tracking-wider text-[11px]">
                Assigned Department
              </h5>

              <div>
                <span className="text-slate-500 block">Department</span>
                <span className="font-bold text-slate-900">{ticket.recommendedDepartment}</span>
              </div>

              <div>
                <span className="text-slate-500 block">Department Head</span>
                <span className="font-medium text-slate-800">
                  {ticket.assignedDepartmentHead || dept.headName}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block">Lead Coordinator</span>
                <span className="font-medium text-slate-800">
                  {ticket.assignedDepartmentCoordinator || dept.leadCoordinator}
                </span>
              </div>

              {/* Assign Technician Dropdown */}
              <div className="pt-2 border-t border-blue-100">
                <label className="block text-slate-700 font-semibold mb-1">
                  Assign Field Technician
                </label>
                <select
                  value={assignedTechnician}
                  onChange={(e) => handleAssignTechnician(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Select Technician --</option>
                  {TECHNICIANS.map((tech) => (
                    <option key={tech} value={tech}>
                      {tech}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Simulated Notification Record */}
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
              <span className="font-semibold text-amber-950 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-amber-600" />
                Notification Log (Simulated)
              </span>
              <p className="text-[11px] text-amber-800">
                Dispatches are prepared for {dept.leadCoordinator} and {dept.headName}. In demo
                mode, alerts are staged without sending outbound SMTP emails.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs">
          <span className="text-slate-500">
            FixMyCampus Ticket Management · SLA standard target:{' '}
            <strong className="text-slate-800">4 Hours</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium rounded transition-colors"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};
