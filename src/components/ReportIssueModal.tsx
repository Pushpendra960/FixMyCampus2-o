import React, { useState, useEffect, useId, useRef, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  Upload,
  CheckCircle2,
  Sparkles,
  UserCheck,
  Building2,
  MapPin,
  ArrowRight,
  ExternalLink,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { BUILDINGS, DEPARTMENTS } from '../data/mockData';
import { CampusTicket, DepartmentInfo, IssueCategory, TicketPriority } from '../types/campus';
import { analyzeIssueWithAI, checkDuplicateTickets } from '../services/aiService';
import { isSafeMediaUrl, storageService, validateImageFile } from '../services/storageService';

interface SubmitTicketResult {
  success: boolean;
  ticketId?: string;
  message?: string;
}

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitTicket: (ticket: CampusTicket) => Promise<SubmitTicketResult>;
  existingTickets: CampusTicket[];
  onSelectExistingTicket?: (ticketId: string) => void;
  initialBuilding?: string;
  initialRoom?: string;
  departmentsMap?: Record<string, DepartmentInfo>;
}

const CATEGORY_TO_DEPT: Record<string, string> = {
  'IT / Audio-Visual Support': 'IT / Audio-Visual Support',
  'IT/AV Support': 'IT / Audio-Visual Support',
  'Classroom Supplies': 'Classroom Supplies',
  'Facilities / Maintenance': 'Facilities / Maintenance',
  'Facilities/Maintenance': 'Facilities / Maintenance',
  'Electrical Maintenance': 'Electrical Maintenance',
  Electrical: 'Electrical Maintenance',
  'Plumbing / Maintenance': 'Plumbing / Maintenance',
  Plumbing: 'Plumbing / Maintenance',
  Housekeeping: 'Housekeeping',
  'General Administration': 'General Administration',
  Other: 'General Administration',
};

const EDITABLE_CATEGORIES: IssueCategory[] = [
  'IT / Audio-Visual Support',
  'Classroom Supplies',
  'Facilities / Maintenance',
  'Electrical Maintenance',
  'Plumbing / Maintenance',
  'Housekeeping',
  'General Administration',
  'Other',
];

const EDITABLE_PRIORITIES: TicketPriority[] = ['Low', 'Medium', 'High', 'Critical'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({
  isOpen,
  onClose,
  onSubmitTicket,
  existingTickets,
  onSelectExistingTicket,
  initialBuilding,
  initialRoom,
  departmentsMap = DEPARTMENTS,
}) => {
  const photoInputId = useId();
  const submitLockRef = useRef(false);

  const [facultyName, setFacultyName] = useState('Dr. Marcus Brody');
  const [facultyEmail, setFacultyEmail] = useState('m.brody@campus.edu');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [notifyReporter, setNotifyReporter] = useState(true);
  const [building, setBuilding] = useState(initialBuilding || BUILDINGS[0]);
  const [roomNumber, setRoomNumber] = useState(initialRoom || 'Room 302');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [photoName, setPhotoName] = useState<string>('');
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedResult, setConfirmedResult] = useState<{ ticketId: string; message: string } | null>(null);

  // AI Classification state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [category, setCategory] = useState<IssueCategory>('IT / Audio-Visual Support');
  const [recommendedDept, setRecommendedDept] = useState('IT / Audio-Visual Support');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [manualCategoryOverride, setManualCategoryOverride] = useState(false);
  const [manualPriorityOverride, setManualPriorityOverride] = useState(false);
  const manualCategoryOverrideRef = useRef(false);
  const manualPriorityOverrideRef = useRef(false);
  manualCategoryOverrideRef.current = manualCategoryOverride;
  manualPriorityOverrideRef.current = manualPriorityOverride;

  const [aiSummary, setAiSummary] = useState('');
  const [urgencyReason, setUrgencyReason] = useState('');
  const [suggestedAction, setSuggestedAction] = useState('');
  const [classificationSource, setClassificationSource] = useState<'gemini' | 'heuristic-fallback'>('heuristic-fallback');
  const [fallbackReason, setFallbackReason] = useState<string | undefined>(undefined);
  const [routingNote, setRoutingNote] = useState<string | undefined>(undefined);

  // Duplicate detection ignore toggle & reactive memoized check
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false);

  const duplicateResult = useMemo(() => {
    if (description.trim().length < 10) {
      return { hasDuplicate: false, similarityScore: 0 };
    }
    return checkDuplicateTickets(roomNumber, category, description, existingTickets);
  }, [roomNumber, category, description, existingTickets]);

  useEffect(() => {
    if (isOpen) {
      if (initialBuilding) setBuilding(initialBuilding);
      if (initialRoom) setRoomNumber(initialRoom);
      setSubmitError(null);
      setPhotoError(null);
      setConfirmedResult(null);
      submitLockRef.current = false;
    }
  }, [isOpen, initialBuilding, initialRoom]);

  // Run AI analysis when description / room / building changes (decoupled from category & ticket list)
  useEffect(() => {
    const trimmed = description.trim();
    if (!trimmed || trimmed.length < 10) {
      setAiSummary('');
      setUrgencyReason('');
      setSuggestedAction('');
      setRoutingNote(undefined);
      setFallbackReason(undefined);
      setIsAnalyzing(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsAnalyzing(true);
      try {
        const result = await analyzeIssueWithAI(description, roomNumber, building);
        if (cancelled) return;

        if (!manualCategoryOverrideRef.current) {
          setCategory(result.category);
          setRecommendedDept(result.recommendedDepartment);
        }
        if (!manualPriorityOverrideRef.current) {
          setPriority(result.priority);
        }
        setAiSummary(result.aiSummary);
        setUrgencyReason(result.urgencyReason);
        setSuggestedAction(result.suggestedAction || '');
        setClassificationSource(result.classificationSource || 'heuristic-fallback');
        setFallbackReason(result.fallbackReason);
        setRoutingNote(result.uncertainRouting ? result.routingNote : undefined);
      } finally {
        if (!cancelled) {
          setIsAnalyzing(false);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [description, roomNumber, building]);

  if (!isOpen) return null;

  // Preset quick fill triggers for demonstrations
  const handleQuickFill = (type: 'projector' | 'markers' | 'chair') => {
    setIgnoreDuplicate(false);
    setManualCategoryOverride(false);
    setManualPriorityOverride(false);
    setSubmitError(null);
    setConfirmedResult(null);
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

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhotoError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setPhotoError(validation.error || 'Invalid image file.');
      e.target.value = '';
      return;
    }

    try {
      const compressed = await storageService.compressImageFile(file);
      setPhotoName(file.name);
      setPhotoUrl(compressed);
    } catch (err: any) {
      setPhotoError(err?.message || 'Failed to process image upload.');
    }
  };

  const handleCategoryChange = (newCat: IssueCategory) => {
    setCategory(newCat);
    setManualCategoryOverride(true);
    setRecommendedDept(CATEGORY_TO_DEPT[newCat] || 'General Administration');
  };

  const validateForm = (): string | null => {
    if (!isAnonymous) {
      const cleanName = facultyName.trim();
      if (cleanName.length < 2 || cleanName.length > 100) {
        return 'Please enter your full name (2–100 characters) or enable Anonymous reporting.';
      }
      const cleanEmail = facultyEmail.trim();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return 'Please enter a valid campus email address (e.g. name@campus.edu).';
      }
    }
    const cleanRoom = roomNumber.trim();
    if (cleanRoom.length < 2 || cleanRoom.length > 80) {
      return 'Please specify the room or hall location (2–80 characters).';
    }
    const cleanDesc = description.trim();
    if (cleanDesc.length < 10) {
      return 'Please provide at least 10 characters describing the issue so triage can route it accurately.';
    }
    if (cleanDesc.length > 2000) {
      return 'Issue description cannot exceed 2000 characters.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    const validationErr = validateForm();
    if (validationErr) {
      setSubmitError(validationErr);
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const deptInfo =
        departmentsMap[recommendedDept] ||
        departmentsMap['General Administration'] ||
        DEPARTMENTS['IT / Audio-Visual Support'];
      const nowStr = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const newTicket: CampusTicket = {
        id: `FMC-PENDING`,
        facultyName: isAnonymous ? 'Anonymous Faculty' : facultyName.trim(),
        isAnonymous,
        facultyEmail: isAnonymous ? undefined : facultyEmail.trim(),
        building,
        roomNumber: roomNumber.trim(),
        description: description.trim(),
        category,
        recommendedDepartment: recommendedDept,
        priority,
        status: 'Open',
        aiSummary: aiSummary || description.trim().slice(0, 70),
        urgencyReason: urgencyReason || 'Standard response priority based on automated impact assessment.',
        suggestedAction: suggestedAction || undefined,
        classificationSource,
        photoUrl,
        reportedAt: nowStr,
        updatedAt: nowStr,
        assignedDepartmentCoordinator: deptInfo.leadCoordinator,
        assignedDepartmentHead: deptInfo.headName,
        timeline: [
          {
            id: `evt-${Date.now()}`,
            timestamp: nowStr,
            action: isAnonymous ? 'Report Submitted Anonymously' : 'Report Submitted',
            actor: isAnonymous ? 'Anonymous Faculty' : facultyName.trim(),
            notes: `Classified as ${category} (${priority} Priority) -> Routed to ${recommendedDept}.`,
          },
        ],
        upvotes: 1,
        notifyReporter: !isAnonymous && notifyReporter,
      };

      const res = await onSubmitTicket(newTicket);
      if (res && res.success) {
        setConfirmedResult({
          ticketId: res.ticketId || 'Recorded',
          message: res.message || 'Ticket submitted and routed successfully.',
        });
        setDescription('');
        setPhotoUrl(undefined);
        setPhotoName('');
        setIgnoreDuplicate(false);
        setManualCategoryOverride(false);
        setManualPriorityOverride(false);
      } else {
        setSubmitError(res?.message || 'Submission failed. Please verify backend connection and try again.');
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Unexpected error while submitting ticket.');
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
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
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Verified Success State */}
        {confirmedResult ? (
          <div className="p-8 space-y-5 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <span className="inline-block font-mono text-xs font-bold px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                {confirmedResult.ticketId}
              </span>
              <h3 className="text-base font-bold text-slate-900">Ticket Verified & Submitted</h3>
              <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                {confirmedResult.message}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmedResult(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              >
                Submit Another Issue
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Quick Demo Pre-fills */}
            <div className="px-6 py-2.5 bg-blue-50/60 border-b border-blue-100 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-blue-900 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                Quick Fill Samples:
              </span>
              <button
                type="button"
                onClick={() => handleQuickFill('projector')}
                className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded hover:bg-blue-100/70 transition-colors"
              >
                Projector Flicker (Room 302)
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('markers')}
                className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded hover:bg-blue-100/70 transition-colors"
              >
                Missing Whiteboard Markers
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('chair')}
                className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded hover:bg-blue-100/70 transition-colors"
              >
                Broken Chair &amp; Safety Risk
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {submitError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

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
                      onChange={(e) => {
                        setIsAnonymous(e.target.checked);
                        setSubmitError(null);
                      }}
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
                        maxLength={100}
                        value={facultyName}
                        onChange={(e) => {
                          setFacultyName(e.target.value);
                          setSubmitError(null);
                        }}
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
                        maxLength={160}
                        value={facultyEmail}
                        onChange={(e) => {
                          setFacultyEmail(e.target.value);
                          setSubmitError(null);
                        }}
                        placeholder="j.smith@campus.edu"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div className="sm:col-span-2 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={notifyReporter}
                          onChange={(e) => setNotifyReporter(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="text-xs text-slate-600">
                          Send me confirmation &amp; lifecycle status email updates at this address
                        </span>
                      </label>
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
                    maxLength={80}
                    value={roomNumber}
                    onChange={(e) => {
                      setRoomNumber(e.target.value);
                      setSubmitError(null);
                    }}
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
                  <div className="flex items-center gap-3">
                    {isAnalyzing && (
                      <span className="text-xs text-blue-600 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                        AI analyzing details...
                      </span>
                    )}
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        description.trim().length < 10 ? 'text-amber-700' : 'text-slate-400'
                      }`}
                    >
                      {description.length} / 2000
                    </span>
                  </div>
                </div>
                <textarea
                  required
                  rows={4}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setSubmitError(null);
                  }}
                  placeholder="Describe what is malfunctioning, classroom impact, and exact equipment involved (minimum 10 characters)..."
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                />
              </div>

              {/* Optional Photo Attachment */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Optional Photo / Visual Evidence (JPEG, PNG, WebP, GIF &bull; Max 10MB)
                </label>
                <div className="flex flex-wrap items-center gap-3">
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
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  {photoName && (
                    <span className="text-xs text-slate-600 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{photoName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoUrl(undefined);
                          setPhotoName('');
                          setPhotoError(null);
                        }}
                        className="text-rose-600 hover:text-rose-800 p-0.5 rounded"
                        title="Remove photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                {photoError && (
                  <p className="mt-1.5 text-xs text-rose-700 font-medium">{photoError}</p>
                )}
                {photoUrl && isSafeMediaUrl(photoUrl) && (
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
                            View &amp; Follow Existing Ticket
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

              {/* AI CLASSIFICATION & EDITABLE OVERRIDES CARD */}
              {description.trim().length >= 10 && (
                <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-blue-900 font-bold text-xs">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      <span>FixMyCampus AI Triage Engine (Editable Routing)</span>
                    </div>
                    <span
                      title={fallbackReason || 'Classified by Gemini AI'}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                        classificationSource === 'gemini'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {classificationSource === 'gemini' ? 'Gemini AI Live' : 'Rule-Engine Fallback'}
                    </span>
                  </div>

                  {classificationSource !== 'gemini' && fallbackReason && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
                      <strong>Fallback Diagnostic:</strong> {fallbackReason}
                    </div>
                  )}

                  {routingNote && (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
                      {routingNote} You can pick a more specific category below before submitting.
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-2.5 bg-white rounded border border-blue-100">
                      <label className="text-slate-500 block mb-1 font-medium">Category</label>
                      <select
                        value={category}
                        onChange={(e) => handleCategoryChange(e.target.value as IssueCategory)}
                        className="w-full text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {EDITABLE_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="p-2.5 bg-white rounded border border-blue-100">
                      <span className="text-slate-500 block mb-1 font-medium">Recommended Dept</span>
                      <span className="font-semibold text-slate-900 block py-1">{recommendedDept}</span>
                    </div>

                    <div className="p-2.5 bg-white rounded border border-blue-100">
                      <label className="text-slate-500 block mb-1 font-medium">Smart Priority</label>
                      <select
                        value={priority}
                        onChange={(e) => {
                          setPriority(e.target.value as TicketPriority);
                          setManualPriorityOverride(true);
                        }}
                        className="w-full text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {EDITABLE_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {aiSummary && (
                    <div className="text-xs text-slate-700 pt-1 space-y-1">
                      <p>
                        <strong className="text-slate-900">Summary: </strong>
                        {aiSummary}
                      </p>
                      <p className="text-slate-600">
                        <strong className="text-slate-900">Urgency Assessment: </strong>
                        {urgencyReason}
                      </p>
                      {suggestedAction && (
                        <p className="text-slate-600">
                          <strong className="text-slate-900">Suggested Dispatch Step: </strong>
                          {suggestedAction}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50"
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
                      <span>Submitting &amp; Dispatching...</span>
                    </>
                  ) : (
                    <>
                      <span>Submit &amp; Dispatch Ticket</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
