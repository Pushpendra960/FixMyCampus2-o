import React, { useState, useEffect, useId } from 'react';
import {
  X,
  AlertTriangle,
  Upload,
  CheckCircle2,
  Sparkles,
  UserCheck,
  Building2,
  MapPin,
  Clock,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { BUILDINGS, DEPARTMENTS } from '../data/mockData';
import { CampusTicket, IssueCategory, TicketPriority } from '../types/campus';
import { analyzeIssueWithAI, checkDuplicateTickets, DuplicateCheckResult } from '../services/aiService';

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitTicket: (ticket: CampusTicket) => Promise<void> | void;
  existingTickets: CampusTicket[];
  onSelectExistingTicket?: (ticketId: string) => void;
}

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({
  isOpen,
  onClose,
  onSubmitTicket,
  existingTickets,
  onSelectExistingTicket,
}) => {
  const photoInputId = useId();
  const [facultyName, setFacultyName] = useState('Dr. Marcus Brody');
  const [facultyEmail, setFacultyEmail] = useState('m.brody@campus.edu');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [building, setBuilding] = useState(BUILDINGS[0]);
  const [roomNumber, setRoomNumber] = useState('Room 302');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [photoName, setPhotoName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // AI Classification state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [category, setCategory] = useState<IssueCategory>('IT / Audio-Visual Support');
  const [recommendedDept, setRecommendedDept] = useState('IT / Audio-Visual Support');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [aiSummary, setAiSummary] = useState('');
  const [urgencyReason, setUrgencyReason] = useState('');
  const [suggestedAction, setSuggestedAction] = useState('');

  // Duplicate detection state
  const [duplicateResult, setDuplicateResult] = useState<DuplicateCheckResult>({
    hasDuplicate: false,
    similarityScore: 0,
  });
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false);

  // Run AI analysis & duplicate check when description / room changes
  useEffect(() => {
    if (!description.trim() || description.length < 10) {
      setAiSummary('');
      setUrgencyReason('');
      setDuplicateResult({ hasDuplicate: false, similarityScore: 0 });
      return;
    }

    const timer = setTimeout(async () => {
      setIsAnalyzing(true);
      try {
        const result = await analyzeIssueWithAI(description, roomNumber, building);
        setCategory(result.category);
        setRecommendedDept(result.recommendedDepartment);
        setPriority(result.priority);
        setAiSummary(result.aiSummary);
        setUrgencyReason(result.urgencyReason);
        setSuggestedAction(result.suggestedAction || '');

        // Check duplicates
        const dup = checkDuplicateTickets(roomNumber, result.category, description, existingTickets);
        setDuplicateResult(dup);
      } finally {
        setIsAnalyzing(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [description, roomNumber, building, existingTickets]);

  if (!isOpen) return null;

  // Preset quick fill triggers for hackathon demonstrations
  const handleQuickFill = (type: 'projector' | 'markers' | 'chair') => {
    setIgnoreDuplicate(false);
    if (type === 'projector') {
      setBuilding('Engineering Hall');
      setRoomNumber('Room 302');
      setDescription(
        'The main ceiling projector is constantly flickering green and shutting down during class. Lamp temperature indicator glows amber.'
      );
    } else if (type === 'markers') {
      setBuilding('Academic Tower A');
      setRoomNumber('Hall 201');
      setDescription(
        'All whiteboard markers in the lecture podium tray are dried out and no whiteboard cleaner is available.'
      );
    } else if (type === 'chair') {
      setBuilding('Science Complex');
      setRoomNumber('Lab 104');
      setDescription(
        'A student workstation swivel chair has a cracked base cylinder with an exposed sharp metal burr. High risk of cutting clothes or skin.'
      );
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoName(file.name);
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        setPhotoUrl(loadEvt.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !roomNumber.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const deptInfo = DEPARTMENTS[recommendedDept] || DEPARTMENTS['IT / Audio-Visual Support'];
      const nowStr = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const newTicket: CampusTicket = {
        id: `FMC-${Math.floor(1000 + Math.random() * 9000)}`, // temporary, storageService will normalize
        facultyName: isAnonymous ? 'Anonymous Faculty' : facultyName,
        isAnonymous,
        facultyEmail: isAnonymous ? undefined : facultyEmail,
        building,
        roomNumber,
        description,
        category,
        recommendedDepartment: recommendedDept,
        priority,
        status: 'Open',
        aiSummary: aiSummary || description.slice(0, 70),
        urgencyReason: urgencyReason || 'Standard response priority based on automated impact assessment.',
        photoUrl,
        reportedAt: nowStr,
        assignedDepartmentCoordinator: deptInfo.leadCoordinator,
        assignedDepartmentHead: deptInfo.headName,
        timeline: [
          {
            id: `evt-${Date.now()}`,
            timestamp: nowStr,
            action: isAnonymous ? 'Report Submitted Anonymously' : 'Report Submitted',
            actor: isAnonymous ? 'Anonymous Faculty' : facultyName,
            notes: `Classified by AI as ${category} (${priority} Priority) -> Routed to ${recommendedDept}.`,
          },
          {
            id: `evt-${Date.now() + 1}`,
            timestamp: nowStr,
            action: 'Coordinator & Department Head Notification Queued',
            actor: 'FixMyCampus Dispatcher',
            notes: `Automated dispatch record prepared for Coordinator ${deptInfo.leadCoordinator} and Dept Head ${deptInfo.headName}.`,
          },
        ],
        upvotes: 1,
      };

      await onSubmitTicket(newTicket);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl my-8 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Report Campus Problem</h2>
            <p className="text-xs text-slate-500">
              Submit an issue for automated classification, priority triage, and department routing.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Demo Pre-fills */}
        <div className="px-6 py-2.5 bg-blue-50/60 border-b border-blue-100 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-blue-900 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            Hackathon Demo Fillers:
          </span>
          <button
            type="button"
            onClick={() => handleQuickFill('projector')}
            className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded hover:bg-blue-100/70 transition-colors"
          >
            Demo: Projector Flicker (Room 302)
          </button>
          <button
            type="button"
            onClick={() => handleQuickFill('markers')}
            className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded hover:bg-blue-100/70 transition-colors"
          >
            Demo: Missing Whiteboard Markers
          </button>
          <button
            type="button"
            onClick={() => handleQuickFill('chair')}
            className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded hover:bg-blue-100/70 transition-colors"
          >
            Demo: Broken Chair & Safety Risk
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Reporter Identification & Anonymous Toggle */}
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Reporter Identity
              </span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-700">
                  Report Anonymously (Identity Protected)
                </span>
              </label>
            </div>

            {isAnonymous ? (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-xs">
                <UserCheck className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>
                  <strong>Anonymous Mode Enabled:</strong> Your name and email address will not be
                  stored in public ticket records or displayed to department technicians.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Faculty / Staff Name
                  </label>
                  <input
                    type="text"
                    required
                    value={facultyName}
                    onChange={(e) => setFacultyName(e.target.value)}
                    placeholder="e.g. Dr. Jane Smith"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Campus Email (for updates)
                  </label>
                  <input
                    type="email"
                    required
                    value={facultyEmail}
                    onChange={(e) => setFacultyEmail(e.target.value)}
                    placeholder="j.smith@campus.edu"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Location Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                Campus Building
              </label>
              <select
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BUILDINGS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                Room / Hall Number
              </label>
              <input
                type="text"
                required
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="e.g. Room 302, Lab 104, Hall 201"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Issue Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Issue Description
              </label>
              {isAnalyzing && (
                <span className="text-xs text-blue-600 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
                  AI analyzing details...
                </span>
              )}
            </div>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what is malfunctioning, classroom impact, and exact equipment involved..."
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
            />
          </div>

          {/* Optional Photo Attachment */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              Optional Photo / Visual Evidence
            </label>
            <div className="flex items-center gap-3">
              <label
                htmlFor={photoInputId}
                className="flex items-center gap-2 px-3.5 py-2 border border-dashed border-slate-300 hover:border-blue-400 bg-slate-50 hover:bg-blue-50/40 rounded-md cursor-pointer text-xs font-medium text-slate-700 transition-colors"
              >
                <Upload className="w-4 h-4 text-slate-500" />
                <span>{photoName ? 'Replace Photo' : 'Upload Equipment / Room Photo'}</span>
              </label>
              <input
                id={photoInputId}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              {photoName && (
                <span className="text-xs text-slate-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  {photoName}
                </span>
              )}
            </div>
            {photoUrl && (
              <div className="mt-2.5 relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200">
                <img
                  src={photoUrl}
                  alt="Issue preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>

          {/* DUPLICATE DETECTION BANNER */}
          {duplicateResult.hasDuplicate && duplicateResult.matchedTicket && !ignoreDuplicate && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">
                      Potential Duplicate Ticket Detected ({duplicateResult.similarityScore}% Match)
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 bg-amber-200/80 rounded font-bold text-amber-950">
                      {duplicateResult.matchedTicket.id}
                    </span>
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    An active ticket already exists for{' '}
                    <strong>{duplicateResult.matchedTicket.roomNumber}</strong> in category{' '}
                    <strong>{duplicateResult.matchedTicket.category}</strong>:
                    <br />
                    <em>&quot;{duplicateResult.matchedTicket.aiSummary}&quot;</em> (Current Status:{' '}
                    <strong>{duplicateResult.matchedTicket.status}</strong>)
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {onSelectExistingTicket && (
                      <button
                        type="button"
                        onClick={() => {
                          if (duplicateResult.matchedTicket) {
                            onSelectExistingTicket(duplicateResult.matchedTicket.id);
                            onClose();
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded flex items-center gap-1 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View & Follow Existing Ticket
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIgnoreDuplicate(true)}
                      className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded transition-colors"
                    >
                      Different Problem — Continue Creating New
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI CLASSIFICATION & SMART PRIORITY PREVIEW CARD */}
          {description.trim().length >= 10 && (
            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-blue-900 font-bold text-xs">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span>FixMyCampus AI Triage Engine</span>
                </div>
                <span className="text-[11px] text-blue-700 font-medium">Auto-Classified</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 bg-white rounded border border-blue-100">
                  <span className="text-slate-500 block mb-0.5 font-medium">Category</span>
                  <span className="font-semibold text-slate-900">{category}</span>
                </div>

                <div className="p-2.5 bg-white rounded border border-blue-100">
                  <span className="text-slate-500 block mb-0.5 font-medium">Recommended Dept</span>
                  <span className="font-semibold text-slate-900">{recommendedDept}</span>
                </div>

                <div className="p-2.5 bg-white rounded border border-blue-100">
                  <span className="text-slate-500 block mb-0.5 font-medium">Smart Priority</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        priority === 'Critical'
                          ? 'bg-rose-600'
                          : priority === 'High'
                          ? 'bg-amber-500'
                          : priority === 'Medium'
                          ? 'bg-blue-600'
                          : 'bg-slate-400'
                      }`}
                    />
                    <span className="font-bold text-slate-900">{priority}</span>
                  </div>
                </div>
              </div>

              {aiSummary && (
                <div className="text-xs text-slate-700 pt-1">
                  <p>
                    <strong className="text-slate-900">Summary: </strong>
                    {aiSummary}
                  </p>
                  <p className="mt-1 text-slate-600">
                    <strong className="text-slate-900">Urgency Assessment: </strong>
                    {urgencyReason}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!description.trim() || !roomNumber.trim() || isSubmitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Submitting & Dispatching...</span>
                </>
              ) : (
                <>
                  <span>Submit & Dispatch Ticket</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
