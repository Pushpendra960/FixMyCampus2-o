import React, { useState, useEffect, useId } from 'react';
import {
  X,
  Clock,
  Building2,
  AlertCircle,
  CheckCircle2,
  Upload,
  User,
  Shield,
  Send,
  ThumbsUp,
  FileText,
  Trash2,
} from 'lucide-react';
import {
  CampusTicket,
  DepartmentInfo,
  ResolutionEvidence,
  SLA_TARGET_HOURS,
  TECHNICIAN_ROSTER,
  TICKET_STATUS_TRANSITIONS,
  TicketStatus,
  VALID_TICKET_STATUSES,
} from '../types/campus';
import { DEPARTMENTS } from '../data/mockData';
import { isSafeMediaUrl, storageService, validateImageFile } from '../services/storageService';

interface UpdateTicketResult {
  success: boolean;
  message?: string;
}

interface TicketDetailModalProps {
  ticket: CampusTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTicket: (updated: CampusTicket) => Promise<UpdateTicketResult>;
  onEvidenceRecorded?: (updated: CampusTicket) => void;
  isBackendLive?: boolean;
  departmentsMap?: Record<string, DepartmentInfo>;
}

function isTechnicianCompatibleWithDepartment(techName: string, departmentName: string): boolean {
  const cleanTech = String(techName || '').trim().toLowerCase();
  if (!cleanTech) return true;
  const cleanDept = String(departmentName || '').trim().toLowerCase();
  if (!cleanDept || cleanDept.includes('general')) return true;

  const profile = TECHNICIAN_ROSTER.find(
    (p) => p.name.toLowerCase() === cleanTech || cleanTech.includes(p.name.split('(')[0].trim().toLowerCase())
  );
  if (!profile) return true;
  return profile.departments.some((d) => {
    const norm = d.toLowerCase();
    return norm === cleanDept || cleanDept.includes(norm) || norm.includes(cleanDept);
  });
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  isOpen,
  onClose,
  onUpdateTicket,
  onEvidenceRecorded,
  isBackendLive = false,
  departmentsMap = DEPARTMENTS,
}) => {
  const evidenceInputId = useId();
  const [currentStatus, setCurrentStatus] = useState<TicketStatus>(ticket?.status || 'Open');
  const [assignedTechnician, setAssignedTechnician] = useState<string>(ticket?.assignedTo || '');
  const [timelineNote, setTimelineNote] = useState('');

  // Resolution workflow states
  const [resolutionNotes, setResolutionNotes] = useState(ticket?.resolution?.notes || '');
  const [resolvedBy, setResolvedBy] = useState(
    ticket?.resolution?.resolvedBy || ticket?.assignedTo || ''
  );
  const [evidencePhotoUrl, setEvidencePhotoUrl] = useState<string | undefined>(
    ticket?.resolution?.photoUrl
  );
  const [evidenceLinkInput, setEvidenceLinkInput] = useState('');
  const [evidenceFileName, setEvidenceFileName] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [evidenceSavedMsg, setEvidenceSavedMsg] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (isOpen && ticket) {
      setCurrentStatus(ticket.status);
      setAssignedTechnician(ticket.assignedTo || '');
      setTimelineNote('');
      setResolutionNotes(ticket.resolution?.notes || '');
      setResolvedBy(ticket.resolution?.resolvedBy || ticket.assignedTo || '');
      const existingUrl = ticket.resolution?.photoUrl;
      setEvidencePhotoUrl(existingUrl);
      setEvidenceLinkInput(
        existingUrl && /^https?:\/\//i.test(existingUrl) ? existingUrl : ''
      );
      setEvidenceFileName('');
      setCloseError(null);
      setUpdateError(null);
      setEvidenceSavedMsg(null);
      setIsUpdating(false);
    }
  }, [isOpen, ticket?.id, ticket?.status, ticket?.assignedTo]);

  if (!isOpen || !ticket) return null;

  const specialistTechnicians = TECHNICIAN_ROSTER.filter((t) =>
    isTechnicianCompatibleWithDepartment(t.name, ticket.recommendedDepartment)
  );
  const otherTechnicians = TECHNICIAN_ROSTER.filter(
    (t) => !isTechnicianCompatibleWithDepartment(t.name, ticket.recommendedDepartment)
  );

  const allowedNextStatuses: TicketStatus[] =
    TICKET_STATUS_TRANSITIONS[ticket.status] || VALID_TICKET_STATUSES;

  const handleEvidenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setCloseError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const check = validateImageFile(file);
    if (!check.valid) {
      setCloseError(check.error || 'Invalid evidence file.');
      e.target.value = '';
      return;
    }

    try {
      const compressed = await storageService.compressImageFile(file);
      setEvidenceFileName(file.name);
      setEvidencePhotoUrl(compressed);
    } catch (err: any) {
      setCloseError(err?.message || 'Failed to read evidence photo.');
    }
  };

  const commitUpdate = async (
    updated: CampusTicket,
    onFailureRevert?: () => void
  ): Promise<boolean> => {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const res = await onUpdateTicket(updated);
      if (!res || !res.success) {
        if (onFailureRevert) onFailureRevert();
        setUpdateError(res?.message || 'Unable to save update to backend.');
        return false;
      }
      return true;
    } catch (err: any) {
      if (onFailureRevert) onFailureRevert();
      setUpdateError(err?.message || 'Unexpected error saving update.');
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusChange = async (newStatus: TicketStatus) => {
    if (newStatus === ticket.status) return;
    setCloseError(null);
    setUpdateError(null);

    if (!allowedNextStatuses.includes(newStatus)) {
      setCloseError(
        `Invalid lifecycle transition: "${ticket.status}" cannot skip directly to "${newStatus}". Allowed next stages: ${allowedNextStatuses.join(', ')}.`
      );
      return;
    }

    // Enforce mandatory technician name, meaningful resolution details, and photo evidence before Resolved/Closed
    if (newStatus === 'Closed' || newStatus === 'Resolved') {
      const effectiveResolver = resolvedBy.trim() || assignedTechnician || ticket.assignedTo || '';
      const rawCandidatePhoto = evidenceLinkInput.trim() || evidencePhotoUrl || ticket.resolution?.photoUrl || '';
      const hasPhotoEvidence = !!rawCandidatePhoto && isSafeMediaUrl(rawCandidatePhoto);
      const effectiveNotes = resolutionNotes.trim() || ticket.resolution?.notes || '';

      if (effectiveResolver.length < 2) {
        setCloseError(
          'Please enter who resolved the ticket (Technician / Staff name) before marking it Resolved or Closed.'
        );
        return;
      }

      if (effectiveNotes.length < 3) {
        setCloseError(
          'Mandatory resolution note is missing. Please document meaningful technician fix details before setting status to Resolved or Closed.'
        );
        return;
      }

      if (!hasPhotoEvidence) {
        setCloseError(
          'Mandatory resolution evidence upload or valid HTTPS proof URL is missing. Photo verification is required before Resolved or Closed.'
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

    const chosenEvidenceRef =
      (evidenceLinkInput.trim() && isSafeMediaUrl(evidenceLinkInput.trim())
        ? evidenceLinkInput.trim()
        : undefined) ||
      (evidencePhotoUrl && isSafeMediaUrl(evidencePhotoUrl) ? evidencePhotoUrl : undefined) ||
      ticket.resolution?.photoUrl;

    const effectiveResolverName = resolvedBy.trim() || assignedTechnician || ticket.assignedTo || 'Technician';

    const updatedResolution: ResolutionEvidence = {
      resolvedAt: ticket.resolution?.resolvedAt || nowStr,
      resolvedBy: effectiveResolverName,
      notes: resolutionNotes.trim() || ticket.resolution?.notes || 'Work completed per protocol.',
      photoUrl: chosenEvidenceRef,
      verifiedAt: newStatus === 'Closed' ? nowStr : ticket.resolution?.verifiedAt,
      verifiedBy: newStatus === 'Closed' ? 'Department Admin' : ticket.resolution?.verifiedBy,
    };

    const newTimeline = [
      ...ticket.timeline,
      {
        id: `evt-${Date.now()}`,
        timestamp: nowStr,
        action: `Status transitioned to ${newStatus}`,
        actor: effectiveResolverName,
        notes: resolutionNotes.trim() ? `Resolution note: ${resolutionNotes.trim()}` : undefined,
      },
    ];

    const updated: CampusTicket = {
      ...ticket,
      status: newStatus,
      assignedTo: assignedTechnician || ticket.assignedTo,
      closedAt: newStatus === 'Closed' ? ticket.closedAt || nowStr : ticket.closedAt,
      timeline: newTimeline,
      resolution:
        newStatus === 'Resolved' || newStatus === 'Closed' || newStatus === 'Pending Verification'
          ? updatedResolution
          : ticket.resolution,
    };

    const previousStatus = currentStatus;
    setCurrentStatus(newStatus);
    await commitUpdate(updated, () => setCurrentStatus(previousStatus));
  };

  const handleAssignTechnician = async (tech: string) => {
    setUpdateError(null);
    if (tech && !isTechnicianCompatibleWithDepartment(tech, ticket.recommendedDepartment)) {
      setUpdateError(
        `"${tech}" specializes in a different trade and cannot be assigned to "${ticket.recommendedDepartment}". Select a specialist matching this department.`
      );
      return;
    }

    const previousTech = assignedTechnician;
    const previousStatus = currentStatus;
    setAssignedTechnician(tech);
    if (tech && !resolvedBy.trim()) {
      setResolvedBy(tech);
    }

    const nowStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const nextStatus: TicketStatus =
      tech && ticket.status === 'Open' ? 'Assigned' : ticket.status;

    const newTimeline = [
      ...ticket.timeline,
      {
        id: `evt-${Date.now()}`,
        timestamp: nowStr,
        action: tech ? `Assigned to ${tech}` : 'Technician Unassigned',
        actor: 'Department Dispatcher',
      },
    ];

    const updated: CampusTicket = {
      ...ticket,
      assignedTo: tech || undefined,
      status: nextStatus,
      timeline: newTimeline,
    };

    setCurrentStatus(nextStatus);
    await commitUpdate(updated, () => {
      setAssignedTechnician(previousTech);
      setCurrentStatus(previousStatus);
    });
  };

  const handleAddTimelineNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const noteText = timelineNote.trim();
    if (!noteText || isUpdating) return;

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
        notes: noteText,
      },
    ];

    const updated: CampusTicket = {
      ...ticket,
      timeline: newTimeline,
    };

    const ok = await commitUpdate(updated);
    if (ok) {
      setTimelineNote('');
    }
  };

  const handleUpvote = async () => {
    if (isUpdating) return;
    const updated: CampusTicket = {
      ...ticket,
      upvotes: (ticket.upvotes || 0) + 1,
    };
    await commitUpdate(updated);
  };

  const handleRecordEvidenceOnly = async () => {
    if (isUpdating || !ticket) return;
    const notesText = resolutionNotes.trim();
    const linkCandidate = evidenceLinkInput.trim();
    if (linkCandidate && !isSafeMediaUrl(linkCandidate)) {
      setCloseError('Please enter a valid http:// or https:// evidence image or Google Drive URL.');
      return;
    }

    const photoRef = linkCandidate || (evidencePhotoUrl && isSafeMediaUrl(evidencePhotoUrl) ? evidencePhotoUrl : '');
    const submitter = resolvedBy.trim() || assignedTechnician || ticket.assignedTo || '';
    if (!notesText && !photoRef) {
      setCloseError('Enter resolution notes or attach a photo / URL before saving evidence.');
      return;
    }
    if (submitter.length < 2) {
      setCloseError('Enter the technician or staff name in "Resolved By" before saving evidence.');
      return;
    }

    setCloseError(null);
    setUpdateError(null);
    setEvidenceSavedMsg(null);
    setIsUpdating(true);

    try {
      let generatedId = `EVD-${Date.now()}`;
      if (isBackendLive) {
        const res = await storageService.addEvidenceToBackend({
          ticketId: ticket.id,
          evidenceType: photoRef ? 'Photo Verification' : 'Resolution Note',
          evidenceReference: photoRef,
          notes: notesText,
          submittedBy: submitter,
        });
        if (!res.success) {
          setUpdateError(res.message);
          return;
        }
        if (res.evidenceId) generatedId = res.evidenceId;
        setEvidenceSavedMsg(
          `Evidence ${res.evidenceId || ''} logged to Google Sheets ResolutionEvidence.`
        );
      }

      const nowStr = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const newEvidenceRecord = {
        evidenceId: generatedId,
        ticketId: ticket.id,
        evidenceType: photoRef ? 'Photo Verification' : 'Resolution Note',
        evidenceReference: photoRef,
        notes: notesText || 'Verification photo attached',
        submittedAt: nowStr,
        submittedBy: submitter,
      };

      const updated: CampusTicket = {
        ...ticket,
        updatedAt: nowStr,
        resolution: {
          resolvedAt: ticket.resolution?.resolvedAt || nowStr,
          resolvedBy: submitter,
          notes: notesText || ticket.resolution?.notes || 'Progress evidence logged.',
          photoUrl: photoRef || ticket.resolution?.photoUrl,
        },
        evidenceRecords: [...(ticket.evidenceRecords || []), newEvidenceRecord],
        timeline: [
          ...ticket.timeline,
          {
            id: `evt-${Date.now()}`,
            timestamp: nowStr,
            action: 'Resolution Evidence Logged',
            actor: submitter,
            notes: notesText || 'Verification photo attached',
          },
        ],
      };

      if (isBackendLive) {
        if (onEvidenceRecorded) {
          onEvidenceRecorded(updated);
        }
      } else {
        const ok = await onUpdateTicket(updated);
        if (ok.success) {
          setEvidenceSavedMsg('Evidence saved locally in demo resolution record.');
        }
      }
    } catch (err: any) {
      setUpdateError(err?.message || 'Failed to save evidence.');
    } finally {
      setIsUpdating(false);
    }
  };

  const dept =
    departmentsMap[ticket.recommendedDepartment] ||
    departmentsMap['General Administration'] ||
    DEPARTMENTS['IT / Audio-Visual Support'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl my-8 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
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
            {ticket.updatedAt && ticket.updatedAt !== ticket.reportedAt && (
              <span className="text-xs font-medium text-slate-500">
                &bull; Updated: <span className="font-mono tabular-nums">{ticket.updatedAt}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isUpdating && (
              <span className="text-xs text-blue-700 font-medium flex items-center gap-1.5 mr-1">
                <span className="w-3 h-3 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
                Saving...
              </span>
            )}
            <button
              type="button"
              disabled={isUpdating}
              onClick={handleUpvote}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200/70 disabled:opacity-50 rounded transition-colors"
              title="Acknowledge / Upvote this issue"
            >
              <ThumbsUp className="w-3.5 h-3.5 text-blue-600" />
              <span>{ticket.upvotes || 1} Impacted</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Backend Update Error Banner */}
        {updateError && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Update Not Saved: </span>
              {updateError}
            </div>
          </div>
        )}

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
              {ticket.suggestedAction && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-800">Suggested Action: </span>
                  {ticket.suggestedAction}
                </p>
              )}
            </div>

            {/* Description & Photo */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Full Problem Description
              </h4>
              <p className="text-sm text-slate-800 bg-white p-3.5 border border-slate-200 rounded-lg whitespace-pre-line leading-relaxed">
                {ticket.description}
              </p>

              {ticket.photoUrl && isSafeMediaUrl(ticket.photoUrl) && (
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
                  Resolution &amp; Evidence Verification
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
                    <span className="font-bold">Transition Blocked: </span>
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
                    maxLength={100}
                    value={resolvedBy}
                    onChange={(e) => {
                      setResolvedBy(e.target.value);
                      setCloseError(null);
                    }}
                    placeholder="e.g. Leo Ramirez"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    Photo Evidence (Upload or URL)
                  </label>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={evidenceInputId}
                      className="flex-1 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-dashed border-slate-300 rounded cursor-pointer text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5 text-slate-500" />
                      <span className="truncate">
                        {evidenceFileName
                          ? evidenceFileName
                          : evidencePhotoUrl || ticket.resolution?.photoUrl
                          ? 'Evidence Photo Attached ✓'
                          : 'Upload Fix Proof Photo'}
                      </span>
                    </label>
                    {(evidencePhotoUrl && !ticket.resolution?.photoUrl) && (
                      <button
                        type="button"
                        onClick={() => {
                          setEvidencePhotoUrl(undefined);
                          setEvidenceFileName('');
                          setEvidenceLinkInput('');
                        }}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded border border-slate-200"
                        title="Remove staged evidence photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id={evidenceInputId}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleEvidenceUpload}
                    className="hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-600 font-medium mb-1">
                  Or Paste Hosted Evidence URL (https://...)
                </label>
                <input
                  type="url"
                  maxLength={500}
                  value={evidenceLinkInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEvidenceLinkInput(val);
                    setCloseError(null);
                    if (isSafeMediaUrl(val)) {
                      setEvidencePhotoUrl(val.trim());
                    }
                  }}
                  placeholder="https://drive.google.com/... or https://example.com/repair-proof.jpg"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 font-medium mb-1">
                  Resolution Notes (Required to Resolve/Close)
                </label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={resolutionNotes}
                  onChange={(e) => {
                    setResolutionNotes(e.target.value);
                    setCloseError(null);
                  }}
                  placeholder="Detail parts replaced, tests conducted, or supplies delivered..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {(() => {
                const previewUrl =
                  (evidenceLinkInput.trim() && isSafeMediaUrl(evidenceLinkInput.trim())
                    ? evidenceLinkInput.trim()
                    : undefined) ||
                  (evidencePhotoUrl && isSafeMediaUrl(evidencePhotoUrl) ? evidencePhotoUrl : undefined) ||
                  (ticket.resolution?.photoUrl && isSafeMediaUrl(ticket.resolution.photoUrl)
                    ? ticket.resolution.photoUrl
                    : undefined);
                if (!previewUrl) return null;
                return (
                  <div className="pt-1">
                    <span className="text-[11px] text-slate-500 block mb-1">Attached Resolution Evidence:</span>
                    <div className="w-32 h-24 rounded border border-slate-200 overflow-hidden bg-white">
                      <img
                        src={previewUrl}
                        alt="Resolution verification proof"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                );
              })()}

              {ticket.evidenceRecords && ticket.evidenceRecords.length > 0 && (
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-600 block">
                    Recorded Sheet Evidence ({ticket.evidenceRecords.length})
                  </span>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {ticket.evidenceRecords.map((ev) => (
                      <div key={ev.evidenceId} className="p-2 bg-white border border-slate-200 rounded text-[11px] flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-blue-700 mr-1.5">{ev.evidenceId}</span>
                          <span className="font-medium text-slate-800">{ev.notes || ev.evidenceType}</span>
                          <span className="text-slate-500 block">
                            by {ev.submittedBy} &bull; <span className="font-mono">{ev.submittedAt}</span>
                          </span>
                        </div>
                        {ev.evidenceReference && isSafeMediaUrl(ev.evidenceReference) && !ev.evidenceReference.startsWith('data:') && (
                          <a
                            href={ev.evidenceReference}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline shrink-0"
                          >
                            View
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {evidenceSavedMsg && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-[11px] font-medium">
                  {evidenceSavedMsg}
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  disabled={isUpdating || (!resolutionNotes.trim() && !evidencePhotoUrl && !evidenceLinkInput.trim())}
                  onClick={handleRecordEvidenceOnly}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-50 rounded transition-colors"
                >
                  Save Evidence to Sheet
                </button>
              </div>
            </div>

            {/* Audit Timeline */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Audit Trail &amp; Status Progression
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
                  maxLength={500}
                  value={timelineNote}
                  onChange={(e) => setTimelineNote(e.target.value)}
                  placeholder="Add operational update or technician dispatch note..."
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={!timelineNote.trim() || isUpdating}
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
                disabled={isUpdating}
                onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              >
                {VALID_TICKET_STATUSES.map((st) => {
                  const isAllowed = allowedNextStatuses.includes(st);
                  return (
                    <option key={st} value={st} disabled={!isAllowed}>
                      {st}{!isAllowed ? ' (Complete earlier stages first)' : ''}
                    </option>
                  );
                })}
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
                  {ticket.building} &middot; <span className="font-mono">{ticket.roomNumber}</span>
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
                  disabled={isUpdating}
                  onChange={(e) => handleAssignTechnician(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                >
                  <option value="">-- Select Technician --</option>
                  <optgroup label={`Recommended (${ticket.recommendedDepartment})`}>
                    {specialistTechnicians.map((tech) => (
                      <option key={tech.name} value={tech.name}>
                        {tech.name}
                      </option>
                    ))}
                  </optgroup>
                  {otherTechnicians.length > 0 && (
                    <optgroup label="Other Departments (Restricted)">
                      {otherTechnicians.map((tech) => (
                        <option key={tech.name} value={tech.name} disabled>
                          {tech.name} — Other Dept
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Validated against <span className="font-medium">{ticket.recommendedDepartment}</span> roster.
                </p>
              </div>
            </div>

            {/* Notification Status Record */}
            <div
              className={`p-3 rounded-lg text-xs space-y-1 border ${
                isBackendLive
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50/60 border-amber-200 text-amber-900'
              }`}
            >
              <span className="font-semibold flex items-center gap-1">
                <FileText className={`w-3.5 h-3.5 ${isBackendLive ? 'text-emerald-600' : 'text-amber-600'}`} />
                {isBackendLive ? 'Live Dispatch & Audit Sync' : 'Notification Log (Local Demo)'}
              </span>
              <p className={`text-[11px] ${isBackendLive ? 'text-emerald-800' : 'text-amber-800'}`}>
                {isBackendLive
                  ? `Connected to Google Sheets. Status transitions, ResolutionEvidence, and AuditLogs sync live; outbound emails use DepartmentDirectory contacts via MailApp.`
                  : `Dispatches are staged locally for ${dept.leadCoordinator} and ${dept.headName}. Connect Google Apps Script to enable live MailApp delivery.`}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs">
          <span className="text-slate-500">
            FixMyCampus Ticket Management &middot; SLA standard target:{' '}
            <strong className="text-slate-800">{SLA_TARGET_HOURS} Hours</strong>
          </span>
          <button
            type="button"
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
