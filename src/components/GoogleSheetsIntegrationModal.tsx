import React, { useState, useEffect } from 'react';
import {
  X,
  Sheet,
  Download,
  Copy,
  Check,
  Code2,
  Table,
  CheckCircle2,
  AlertCircle,
  Link2,
  Activity,
  UploadCloud,
  ShieldAlert,
  Database,
  RefreshCw,
  Mail,
  Send,
  Pencil,
  Save,
} from 'lucide-react';
import {
  BackendConnectionStatus,
  CampusTicket,
  DepartmentDirectoryRow,
  DepartmentDirectorySummary,
} from '../types/campus';
import { storageService } from '../services/storageService';
import { APPS_SCRIPT_SOURCE } from '../data/appsScriptCode';

interface GoogleSheetsIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tickets: CampusTicket[];
  liveLogs?: any[];
  rawDepartments?: DepartmentDirectoryRow[];
  deptEmailSummary?: DepartmentDirectorySummary | null;
  mailStatus?: {
    authorized: boolean | null;
    diagnostic?: string;
    remainingQuota?: number | null;
  };
  onDepartmentsUpdated?: (rows: DepartmentDirectoryRow[], summary?: DepartmentDirectorySummary | null) => void;
  onMailStatusUpdated?: (next: { authorized: boolean | null; diagnostic?: string; remainingQuota?: number | null }) => void;
  onBackendUrlUpdated?: (url: string) => void;
  onConnectionStatusChange?: (status: BackendConnectionStatus) => void;
}

const DEFAULT_DEPLOYED_URL =
  'https://script.google.com/macros/s/AKfycbyx33XJsuqoWM27AoW7sFtEIdwjNldHFvdQX3jtu6EioZBxb_2oRzqRDFIyz-wPEMlUSA/exec';

function classifyWebAppUrlFormat(url: string): {
  valid: boolean;
  errorType?: string;
  message?: string;
  diagnosticHint?: string;
} {
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'script.google.com' ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.startsWith('/macros/s/')
    ) {
      return {
        valid: false,
        errorType: 'INVALID_DEPLOYMENT_URL',
        message:
          'Invalid URL format. Please enter a Google Apps Script Web App URL starting with https://script.google.com/macros/s/.../exec',
        diagnosticHint: 'Verify the URL is copied from Deploy > Manage deployments in Google Apps Script.',
      };
    }

    if (/\/dev\/?$/i.test(parsed.pathname)) {
      return {
        valid: false,
        errorType: 'DEV_URL_NOT_SUPPORTED',
        message:
          'You entered a "/dev" test deployment URL. "/dev" URLs redirect automated requests to a Google Sign-In HTML page instead of JSON.',
        diagnosticHint:
          'Publish via Deploy > Manage deployments > New version (Execute as: Me, Who has access: Anyone) and copy the URL ending in /exec.',
      };
    }

    if (!/\/macros\/s\/[a-zA-Z0-9_-]+\/exec\/?$/i.test(parsed.pathname)) {
      return {
        valid: false,
        errorType: 'INVALID_DEPLOYMENT_URL',
        message: 'Google Apps Script Web App URL must end with /exec.',
        diagnosticHint: 'Copy the /exec Web App URL from Deploy > Manage deployments (not /edit or /dev).',
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      errorType: 'INVALID_DEPLOYMENT_URL',
      message:
        'Malformed URL. Please enter a valid Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec).',
      diagnosticHint: 'Ensure the URL begins with https://script.google.com/macros/s/ and ends with /exec.',
    };
  }
}

/**
 * Prevents spreadsheet formula evaluation if an exported cell starts with =, +, -, @, tab, or CR.
 */
function sanitizeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const GoogleSheetsIntegrationModal: React.FC<GoogleSheetsIntegrationModalProps> = ({
  isOpen,
  onClose,
  tickets,
  liveLogs = [],
  rawDepartments = [],
  deptEmailSummary = null,
  mailStatus,
  onDepartmentsUpdated,
  onMailStatusUpdated,
  onBackendUrlUpdated,
  onConnectionStatusChange,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'live-sheet' | 'payload' | 'appsscript'>('config');

  // Backend URL configuration
  const [webAppUrl, setWebAppUrl] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
    errorType?: string;
    diagnosticHint?: string;
    details?: string;
    sheetsFound?: string[];
    missingSheets?: string[];
    mailAuthorized?: boolean;
    mailRemainingQuota?: number | null;
    mailDiagnostic?: string;
  }>({
    status: 'idle',
    message: '',
  });

  // Safe Test Email state
  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [testEmailOutcome, setTestEmailOutcome] = useState<{
    success: boolean;
    status: string;
    message: string;
  } | null>(null);

  // Local / synced DepartmentDirectory config & inline edit state
  const [localDepts, setLocalDepts] = useState<DepartmentDirectoryRow[]>(rawDepartments);
  const [localDeptSummary, setLocalDeptSummary] = useState<DepartmentDirectorySummary | null>(deptEmailSummary);
  const [editingDeptName, setEditingDeptName] = useState<string | null>(null);
  const [editRespEmail, setEditRespEmail] = useState('');
  const [editHeadEmail, setEditHeadEmail] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [isSavingDept, setIsSavingDept] = useState(false);
  const [deptSaveFeedback, setDeptSaveFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Live Sheet tickets inspector
  const [selectedSheetTab, setSelectedSheetTab] = useState<
    'Tickets' | 'DepartmentDirectory' | 'NotificationLogs' | 'ResolutionEvidence' | 'AuditLogs'
  >('Tickets');
  const [isFetchingSheetTickets, setIsFetchingSheetTickets] = useState(false);
  const [sheetTickets, setSheetTickets] = useState<any[] | null>(null);
  const [sheetFetchError, setSheetFetchError] = useState<string | null>(null);

  const lastSyncMeta = storageService.getLastSyncMeta();

  useEffect(() => {
    setLocalDepts(rawDepartments);
  }, [rawDepartments]);

  useEffect(() => {
    setLocalDeptSummary(deptEmailSummary);
  }, [deptEmailSummary]);

  // Load configured backend URL on open WITHOUT overwriting user's Demo Mode choice
  useEffect(() => {
    if (isOpen) {
      const saved = storageService.getBackendUrl();
      setWebAppUrl(saved);
      setSyncResult(null);
      setTestEmailOutcome(null);
      setDeptSaveFeedback(null);
      setEditingDeptName(null);
      if (saved) {
        handleTestConnection(saved, false);
      } else {
        setTestResult({ status: 'idle', message: '' });
        setSheetTickets(null);
        setSheetFetchError(null);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sheetsPayload = storageService.exportToSheetsPayload(tickets);

  const handleSaveUrl = (urlToSave?: string) => {
    const trimmed = (urlToSave !== undefined ? urlToSave : webAppUrl).trim();
    if (trimmed) {
      const check = classifyWebAppUrlFormat(trimmed);
      if (!check.valid) {
        setTestResult({
          status: 'error',
          errorType: check.errorType,
          diagnosticHint: check.diagnosticHint,
          message:
            check.message ||
            'Invalid URL format. Please enter a Google Apps Script Web App URL starting with https://script.google.com/macros/s/.../exec',
        });
        return;
      }
    }

    setWebAppUrl(trimmed);
    storageService.setBackendUrl(trimmed);
    if (onBackendUrlUpdated) {
      onBackendUrlUpdated(trimmed);
    }

    if (trimmed) {
      handleTestConnection(trimmed, true);
    } else {
      setTestResult({
        status: 'idle',
        message: 'Backend URL cleared. System returned to local demo mode.',
      });
      setSheetTickets(null);
      if (onConnectionStatusChange) onConnectionStatusChange('demo');
    }
  };

  const handleTestConnection = async (urlToTest?: string, persistOnSuccess = true) => {
    const target = (urlToTest !== undefined ? urlToTest : webAppUrl).trim();
    if (!target) {
      setTestResult({
        status: 'error',
        errorType: 'INVALID_DEPLOYMENT_URL',
        message: 'Please paste your Google Apps Script Web App URL first.',
        diagnosticHint: 'Copy the /exec URL from Google Apps Script Deploy > Manage deployments.',
      });
      if (onConnectionStatusChange) onConnectionStatusChange('demo');
      return;
    }

    const formatCheck = classifyWebAppUrlFormat(target);
    if (!formatCheck.valid) {
      setTestResult({
        status: 'error',
        errorType: formatCheck.errorType,
        diagnosticHint: formatCheck.diagnosticHint,
        message: formatCheck.message || 'Invalid URL format. Expected https://script.google.com/macros/s/.../exec',
      });
      if (onConnectionStatusChange) onConnectionStatusChange('error');
      return;
    }

    setIsTesting(true);
    setTestResult({ status: 'idle', message: 'Testing connection to Google Apps Script backend (action: health)...' });
    if (onConnectionStatusChange) onConnectionStatusChange('connecting');

    const result = await storageService.testBackendConnection(target);
    setIsTesting(false);

    if (result.success) {
      const detailsObj = result.details && typeof result.details === 'object' ? result.details : null;
      const isMailAuth = typeof detailsObj?.mailAuthorized === 'boolean' ? detailsObj.mailAuthorized : undefined;
      const quota = typeof detailsObj?.mailRemainingQuota === 'number' ? detailsObj.mailRemainingQuota : null;
      const mailDiag = typeof detailsObj?.mailDiagnostic === 'string' ? detailsObj.mailDiagnostic : undefined;
      setTestResult({
        status: 'success',
        errorType: result.errorType || 'OK',
        message: result.message || 'Connected successfully to live Google Apps Script backend.',
        details: detailsObj ? JSON.stringify(detailsObj) : result.details,
        sheetsFound: Array.isArray(detailsObj?.sheetsFound) ? detailsObj.sheetsFound : undefined,
        missingSheets: Array.isArray(detailsObj?.missingSheets) ? detailsObj.missingSheets : undefined,
        mailAuthorized: isMailAuth,
        mailRemainingQuota: quota,
        mailDiagnostic: mailDiag,
      });
      if (onMailStatusUpdated && isMailAuth !== undefined) {
        onMailStatusUpdated({ authorized: isMailAuth, diagnostic: mailDiag, remainingQuota: quota });
      }
      if (detailsObj?.departmentEmailSummary) {
        setLocalDeptSummary(detailsObj.departmentEmailSummary);
      }
      if (persistOnSuccess) {
        storageService.setBackendUrl(target);
      }
      if (onConnectionStatusChange) onConnectionStatusChange('live');
      fetchLiveSheetRecords(target);
      storageService.fetchDepartments(target).then((deptRes) => {
        if (deptRes.success && Array.isArray(deptRes.departments)) {
          setLocalDepts(deptRes.departments);
          setLocalDeptSummary(deptRes.summary || null);
          if (onDepartmentsUpdated) {
            onDepartmentsUpdated(deptRes.departments, deptRes.summary || null);
          }
        }
      }).catch(() => {});
    } else {
      setTestResult({
        status: 'error',
        errorType: result.errorType,
        diagnosticHint: result.diagnosticHint,
        message: result.message || 'Backend connection failed.',
        details: typeof result.details === 'object' ? JSON.stringify(result.details) : result.details,
      });
      if (onConnectionStatusChange) onConnectionStatusChange('error');
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webAppUrl.trim() || !testEmailRecipient.trim() || isSendingTestEmail) return;
    setIsSendingTestEmail(true);
    setTestEmailOutcome(null);
    const res = await storageService.sendTestEmail(testEmailRecipient.trim(), webAppUrl.trim(), 'System Admin');
    setIsSendingTestEmail(false);
    setTestEmailOutcome({
      success: res.success,
      status: res.status,
      message: res.message,
    });
    if (res.success && onMailStatusUpdated) {
      onMailStatusUpdated({
        authorized: true,
        remainingQuota: res.remainingQuota ?? testResult.mailRemainingQuota ?? null,
        diagnostic: `MailApp authorized (remaining daily quota: ${res.remainingQuota ?? 'ready'}).`,
      });
    }
  };

  const handleStartEditDept = (row: DepartmentDirectoryRow) => {
    setEditingDeptName(String(row.Department || '').trim());
    setEditRespEmail(String(row.ResponsibleEmail || '').trim());
    setEditHeadEmail(String(row.DepartmentHeadEmail || '').trim());
    const activeRaw = row.IsActive !== undefined ? row.IsActive : row.Active;
    setEditActive(activeRaw === undefined || activeRaw === true || String(activeRaw).toLowerCase() === 'true');
    setDeptSaveFeedback(null);
  };

  const handleSaveDeptConfig = async () => {
    if (!editingDeptName || !webAppUrl.trim() || isSavingDept) return;
    setIsSavingDept(true);
    setDeptSaveFeedback(null);
    const res = await storageService.updateDepartmentConfig(
      {
        department: editingDeptName,
        responsibleEmail: editRespEmail.trim(),
        departmentHeadEmail: editHeadEmail.trim(),
        active: editActive,
        actor: 'System Admin',
      },
      webAppUrl.trim()
    );
    setIsSavingDept(false);
    setDeptSaveFeedback({ success: res.success, message: res.message });
    if (res.success && Array.isArray(res.departments)) {
      setLocalDepts(res.departments);
      setLocalDeptSummary(res.summary || null);
      if (onDepartmentsUpdated) {
        onDepartmentsUpdated(res.departments, res.summary || null);
      }
      setEditingDeptName(null);
    }
  };

  // Derive email log telemetry cleanly from live NotificationLogs
  const effectiveMailAuth =
    testResult.mailAuthorized !== undefined ? testResult.mailAuthorized : mailStatus?.authorized ?? null;
  const effectiveQuota =
    testResult.mailRemainingQuota !== undefined
      ? testResult.mailRemainingQuota
      : mailStatus?.remainingQuota ?? null;

  const sortedLiveLogs = [...liveLogs].reverse();
  const lastAttemptLog = sortedLiveLogs[0];
  const lastSuccessLog = sortedLiveLogs.find(
    (r) => String(r.Status || r.Result || '').toUpperCase() === 'SENT'
  );
  const lastFailureLog = sortedLiveLogs.find((r) => {
    const st = String(r.Status || r.Result || '').toUpperCase();
    return st === 'FAILED' || st === 'SKIPPED';
  });

  const fetchLiveSheetRecords = async (
    urlToQuery?: string,
    tabName: 'Tickets' | 'DepartmentDirectory' | 'NotificationLogs' | 'ResolutionEvidence' | 'AuditLogs' = selectedSheetTab
  ) => {
    const target = (urlToQuery || webAppUrl).trim();
    if (!target) return;

    setIsFetchingSheetTickets(true);
    setSheetFetchError(null);

    try {
      if (tabName === 'Tickets') {
        const res = await storageService.fetchBackendTickets(target);
        if (res.success && res.rawTickets) {
          setSheetTickets(res.rawTickets);
        } else if (res.success && res.tickets) {
          setSheetTickets(res.tickets);
        } else {
          setSheetFetchError(res.message || 'Could not fetch tickets from backend.');
        }
      } else if (tabName === 'DepartmentDirectory') {
        const res = await storageService.fetchDepartments(target);
        if (res.success && res.departments) {
          setSheetTickets(res.departments);
        } else {
          setSheetFetchError(res.message || 'Could not fetch DepartmentDirectory.');
        }
      } else {
        const res = await storageService.fetchBackendLogs(target, tabName);
        if (res.success) {
          if (tabName === 'NotificationLogs') setSheetTickets(res.notificationLogs || []);
          else if (tabName === 'ResolutionEvidence') setSheetTickets(res.evidence || []);
          else if (tabName === 'AuditLogs') setSheetTickets(res.auditLogs || []);
        } else {
          setSheetFetchError(res.message || `Could not fetch ${tabName}.`);
        }
      }
    } catch (err: any) {
      setSheetFetchError(err.message || 'Failed to query live sheet data.');
    } finally {
      setIsFetchingSheetTickets(false);
    }
  };

  const handleSyncAll = async () => {
    if (!webAppUrl.trim()) {
      setTestResult({
        status: 'error',
        message: 'Cannot sync: Please provide and save your Web App URL first.',
      });
      return;
    }

    setIsSyncingAll(true);
    setSyncResult(null);

    const res = await storageService.syncAllToBackend(tickets, webAppUrl.trim());
    setIsSyncingAll(false);

    if (res.success) {
      setSyncResult(res.message);
      fetchLiveSheetRecords();
    } else {
      setSyncResult(`Sync Error: ${res.message}`);
    }
  };

  const sampleAppsScriptCode = APPS_SCRIPT_SOURCE;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(sampleAppsScriptCode);
      setCopied(true);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = sampleAppsScriptCode;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCSV = () => {
    const headers = [
      'Ticket ID',
      'Timestamp',
      'Reporter',
      'Building',
      'Room',
      'Category',
      'Priority',
      'Status',
      'Assigned To',
      'Coordinator',
      'Summary',
      'Resolved At',
      'Resolved By',
    ];

    const rows = sheetsPayload.map((item) => [
      sanitizeCsvCell(item.ticket_id),
      sanitizeCsvCell(item.timestamp),
      sanitizeCsvCell(item.reporter),
      sanitizeCsvCell(item.building),
      sanitizeCsvCell(item.room),
      sanitizeCsvCell(item.category),
      sanitizeCsvCell(item.priority),
      sanitizeCsvCell(item.status),
      sanitizeCsvCell(item.assigned_to),
      sanitizeCsvCell(item.coordinator),
      sanitizeCsvCell(item.summary),
      sanitizeCsvCell(item.resolved_at),
      sanitizeCsvCell(item.resolved_by),
    ]);

    const csvText = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', objectUrl);
    link.setAttribute('download', `FixMyCampus_Tickets_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl my-8 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sheet className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Google Sheets &amp; Google Apps Script Backend Settings
              </h2>
              <p className="text-xs text-slate-500">
                Connect your deployed Google Apps Script Web App to log live tickets directly to your Google Sheet.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Backend Connection Indicator Bar */}
        <div className="px-6 py-2.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Backend Status:</span>
            {isTesting ? (
              <span className="flex items-center gap-1 font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                Testing Connection...
              </span>
            ) : testResult.status === 'success' ? (
              <span className="flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Live Google Apps Script Connected
              </span>
            ) : testResult.status === 'error' ? (
              <span className="flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                Connection Error
              </span>
            ) : (
              <span className="flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                Demo Mode (Local State Only)
              </span>
            )}
          </div>

          <div className="text-[11px] text-slate-500 font-mono">
            {lastSyncMeta?.lastSyncAt
              ? `Last sync: ${new Date(lastSyncMeta.lastSyncAt).toLocaleTimeString()} (${lastSyncMeta.count} tickets)`
              : webAppUrl
              ? 'Custom Web App URL configured'
              : 'No Web App URL set'}
          </div>
        </div>

        {/* Tab switch */}
        <div className="px-6 pt-3 border-b border-slate-200 flex items-center gap-4 text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'config'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>Backend URL &amp; Live Sync</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('live-sheet');
              if (!sheetTickets && webAppUrl) fetchLiveSheetRecords(webAppUrl);
            }}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'live-sheet'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="w-4 h-4 text-emerald-600" />
            <span>Live Sheet Records</span>
            {sheetTickets && (
              <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 text-[10px] rounded-full font-bold">
                {sheetTickets.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payload')}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'payload'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Table className="w-4 h-4" />
            <span>Inspect Payload ({tickets.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('appsscript')}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'appsscript'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Apps Script Code</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
          {activeTab === 'config' && (
            <div className="space-y-4">
              {/* Web App URL Settings Input */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Deployed Google Apps Script Web App URL
                    </label>
                    <div className="flex items-center gap-3">
                      {webAppUrl !== DEFAULT_DEPLOYED_URL && (
                        <button
                          type="button"
                          onClick={() => handleSaveUrl(DEFAULT_DEPLOYED_URL)}
                          className="text-[11px] text-blue-600 hover:underline font-medium"
                        >
                          Use Pre-configured Deployment URL
                        </button>
                      )}
                      {webAppUrl && (
                        <button
                          type="button"
                          onClick={() => handleSaveUrl('')}
                          className="text-[11px] text-rose-600 hover:underline font-medium"
                        >
                          Clear URL (Demo Mode)
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    Paste your deployment URL (starts with{' '}
                    <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded">
                      https://script.google.com/macros/s/.../exec
                    </code>
                    ). Clearing the URL keeps FixMyCampus in local Demo Mode.
                  </p>
                  <div className="flex flex-wrap sm:flex-nowrap gap-2">
                    <input
                      type="url"
                      value={webAppUrl}
                      onChange={(e) => setWebAppUrl(e.target.value)}
                      placeholder="https://script.google.com/macros/s/AKfycbx.../exec"
                      className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveUrl()}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap shadow-xs"
                    >
                      Save URL
                    </button>
                    <button
                      type="button"
                      disabled={isTesting || !webAppUrl.trim()}
                      onClick={() => handleTestConnection()}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5"
                    >
                      <Activity className={`w-3.5 h-3.5 text-blue-600 ${isTesting ? 'animate-spin' : ''}`} />
                      <span>{isTesting ? 'Pinging...' : 'Test Connection'}</span>
                    </button>
                  </div>
                </div>

                {/* Status Feedback Result */}
                {testResult.message && (
                  <div
                    className={`p-3 rounded-md text-xs border space-y-1.5 ${
                      testResult.status === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : testResult.status === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="font-semibold flex flex-wrap items-center gap-1.5">
                      {testResult.status === 'success' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      )}
                      {testResult.status === 'error' && (
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      {testResult.status === 'error' && testResult.errorType && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-900">
                          {testResult.errorType}
                        </span>
                      )}
                      <span>{testResult.message}</span>
                    </div>
                    {testResult.status === 'error' && testResult.diagnosticHint && (
                      <div className="text-[11px] bg-white/70 border border-rose-200 rounded px-2.5 py-1.5 text-rose-900">
                        <strong>Fix / Diagnostic Hint:</strong> {testResult.diagnosticHint}
                      </div>
                    )}
                    {testResult.sheetsFound && testResult.sheetsFound.length > 0 && (
                      <div className="text-[11px] text-emerald-800">
                        Verified Sheets: <span className="font-mono">{testResult.sheetsFound.join(', ')}</span>
                      </div>
                    )}
                    {testResult.missingSheets && testResult.missingSheets.length > 0 && (
                      <div className="text-[11px] text-amber-800">
                        Missing Sheets: <span className="font-mono">{testResult.missingSheets.join(', ')}</span>
                      </div>
                    )}
                    {testResult.mailAuthorized !== undefined && (
                      <div
                        className={`text-[11px] font-medium ${
                          testResult.mailAuthorized ? 'text-emerald-800' : 'text-amber-900'
                        }`}
                      >
                        MailApp Authorization:{' '}
                        <span className="font-bold">
                          {testResult.mailAuthorized ? 'Authorized (Quota Ready)' : 'Authorization Needed'}
                        </span>
                        {testResult.mailDiagnostic ? ` — ${testResult.mailDiagnostic}` : ''}
                      </div>
                    )}
                    {testResult.details && (
                      <p className="text-[11px] font-mono text-slate-600 break-all whitespace-pre-wrap">
                        Response: {testResult.details}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Email Notifications & MailApp Diagnostics Panel */}
              <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-600" />
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Email Notifications &amp; MailApp Diagnostics
                    </h4>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                      testResult.status !== 'success'
                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                        : effectiveMailAuth === true
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : effectiveMailAuth === false
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {testResult.status !== 'success'
                      ? 'Backend Not Connected'
                      : effectiveMailAuth === true
                      ? `MailApp Authorized${effectiveQuota !== null ? ` (${effectiveQuota} daily quota left)` : ''}`
                      : effectiveMailAuth === false
                      ? 'MailApp Authorization Required'
                      : 'Status Pending'}
                  </span>
                </div>

                {/* Diagnostic Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                    <span className="text-[11px] text-slate-500 block">Configured Departments</span>
                    <span className="font-bold text-slate-900">
                      {localDeptSummary
                        ? `${localDeptSummary.configuredDepartments} / ${localDeptSummary.activeDepartments} Active Ready`
                        : localDepts.length > 0
                        ? `${localDepts.filter((d) => d.ResponsibleEmailValid).length} / ${localDepts.length} Ready`
                        : 'Connect to inspect'}
                    </span>
                  </div>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                    <span className="text-[11px] text-slate-500 block">Last Successful Email</span>
                    <span className="font-medium text-emerald-800 block truncate" title={lastSuccessLog ? `${lastSuccessLog.Recipient} (${lastSuccessLog.Timestamp})` : ''}>
                      {lastSuccessLog
                        ? `${lastSuccessLog.TicketID} → ${lastSuccessLog.Recipient}`
                        : 'None recorded yet'}
                    </span>
                  </div>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                    <span className="text-[11px] text-slate-500 block">Last Attempt / Failure</span>
                    <span
                      className={`font-medium block truncate ${
                        lastFailureLog ? 'text-rose-700' : 'text-slate-700'
                      }`}
                      title={lastFailureLog?.Details || lastAttemptLog?.Details || ''}
                    >
                      {lastFailureLog
                        ? `${lastFailureLog.Status}: ${lastFailureLog.Details}`
                        : lastAttemptLog
                        ? `${lastAttemptLog.Status} (${lastAttemptLog.TicketID})`
                        : 'No dispatches yet'}
                    </span>
                  </div>
                </div>

                {localDeptSummary &&
                  (localDeptSummary.missingResponsibleCount > 0 || localDeptSummary.missingHeadCount > 0) && (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 space-y-0.5">
                      {localDeptSummary.missingResponsibleCount > 0 && (
                        <div>
                          <strong>Missing ResponsibleEmail ({localDeptSummary.missingResponsibleCount}):</strong>{' '}
                          {localDeptSummary.missingResponsibleEmail.join(', ')}
                        </div>
                      )}
                      {localDeptSummary.missingHeadCount > 0 && (
                        <div>
                          <strong>Missing Head CC Email ({localDeptSummary.missingHeadCount}):</strong>{' '}
                          {localDeptSummary.missingHeadEmail.join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                {/* Safe Diagnostic Test Email Sender */}
                <form onSubmit={handleSendTestEmail} className="pt-1 border-t border-slate-100 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      Send Safe Test Email (Diagnostics Only)
                    </label>
                    <span className="text-[11px] text-slate-500">
                      Sends 1 test email via MailApp &bull; creates zero tickets or department alerts
                    </span>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap gap-2">
                    <input
                      type="email"
                      required
                      maxLength={160}
                      value={testEmailRecipient}
                      onChange={(e) => setTestEmailRecipient(e.target.value)}
                      placeholder="Enter recipient email to test delivery..."
                      className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={isSendingTestEmail || !webAppUrl.trim() || !testEmailRecipient.trim()}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isSendingTestEmail ? 'Sending...' : 'Send Test Email'}</span>
                    </button>
                  </div>
                  {testEmailOutcome && (
                    <div
                      className={`p-2 rounded text-xs border ${
                        testEmailOutcome.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      <strong>{testEmailOutcome.status}:</strong> {testEmailOutcome.message}
                    </div>
                  )}
                </form>
              </div>

              {/* DepartmentDirectory Email Configuration Editor (Non-Destructive) */}
              {localDepts.length > 0 && (
                <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      DepartmentDirectory Email Routing Configuration
                    </h4>
                    <span className="text-[11px] text-slate-500">
                      Edit emails safely without deleting sheet rows
                    </span>
                  </div>
                  {deptSaveFeedback && (
                    <div
                      className={`p-2 rounded text-xs border ${
                        deptSaveFeedback.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {deptSaveFeedback.message}
                    </div>
                  )}
                  <div className="border border-slate-200 rounded overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                        <tr>
                          <th className="px-2.5 py-2">Department</th>
                          <th className="px-2.5 py-2">Responsible Email (To)</th>
                          <th className="px-2.5 py-2">Head Email (CC)</th>
                          <th className="px-2.5 py-2">Config Status</th>
                          <th className="px-2.5 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {localDepts.map((dept, i) => {
                          const dName = String(dept.Department || `Dept-${i}`);
                          const isEditing = editingDeptName === dName;
                          const statusLabel = dept.EmailConfigStatus || (dept.ResponsibleEmail ? 'Configured' : 'Missing Responsible Email');
                          return (
                            <tr key={dName} className="hover:bg-slate-50/80">
                              <td className="px-2.5 py-2 font-medium text-slate-900 whitespace-nowrap">
                                {dName}
                              </td>
                              <td className="px-2.5 py-2 font-mono text-[11px]">
                                {isEditing ? (
                                  <input
                                    type="email"
                                    value={editRespEmail}
                                    onChange={(e) => setEditRespEmail(e.target.value)}
                                    placeholder="coordinator@domain.edu"
                                    className="w-44 px-2 py-1 border border-blue-400 rounded text-xs font-mono"
                                  />
                                ) : (
                                  <span className={dept.ResponsibleEmail ? 'text-slate-700' : 'text-amber-700 italic'}>
                                    {dept.ResponsibleEmail || 'Not configured'}
                                  </span>
                                )}
                              </td>
                              <td className="px-2.5 py-2 font-mono text-[11px]">
                                {isEditing ? (
                                  <input
                                    type="email"
                                    value={editHeadEmail}
                                    onChange={(e) => setEditHeadEmail(e.target.value)}
                                    placeholder="head@domain.edu (optional)"
                                    className="w-44 px-2 py-1 border border-blue-400 rounded text-xs font-mono"
                                  />
                                ) : (
                                  <span className={dept.DepartmentHeadEmail ? 'text-slate-600' : 'text-slate-400 italic'}>
                                    {dept.DepartmentHeadEmail || 'Optional CC unset'}
                                  </span>
                                )}
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                {isEditing ? (
                                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={editActive}
                                      onChange={(e) => setEditActive(e.target.checked)}
                                    />
                                    <span>Active</span>
                                  </label>
                                ) : (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      statusLabel === 'Configured'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : statusLabel === 'Missing Head CC'
                                        ? 'bg-sky-100 text-sky-800'
                                        : statusLabel === 'Inactive'
                                        ? 'bg-slate-200 text-slate-700'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {statusLabel}
                                  </span>
                                )}
                              </td>
                              <td className="px-2.5 py-2 text-right whitespace-nowrap">
                                {isEditing ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={isSavingDept}
                                      onClick={handleSaveDeptConfig}
                                      className="px-2 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 inline-flex items-center gap-1"
                                    >
                                      <Save className="w-3 h-3" />
                                      <span>{isSavingDept ? 'Saving...' : 'Save'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingDeptName(null)}
                                      className="px-2 py-1 text-[11px] bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditDept(dept)}
                                    className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded inline-flex items-center gap-1"
                                  >
                                    <Pencil className="w-3 h-3" />
                                    <span>Edit</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sync Active Tickets to Sheet */}
              <div className="p-4 bg-white border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Bulk Push Active Tickets to Google Sheet
                  </h4>
                  <p className="text-xs text-slate-500">
                    Synchronize all current {tickets.length} tickets to your Google Sheet in one batch.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isSyncingAll || !webAppUrl.trim() || testResult.status !== 'success'}
                  onClick={handleSyncAll}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-1.5 self-start sm:self-auto shrink-0 shadow-xs"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isSyncingAll ? 'Synchronizing...' : 'Sync All Tickets Now'}</span>
                </button>
              </div>

              {syncResult && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-md text-xs font-medium">
                  {syncResult}
                </div>
              )}

              {/* Instructions on where to paste and how to test */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs text-slate-700">
                <h5 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                  Apps Script Update &amp; MailApp OAuth Setup Steps:
                </h5>
                <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed">
                  <li>
                    Copy the updated script from the <strong>Apps Script Code</strong> tab and replace <code>Code.gs</code> in Google Apps Script.
                  </li>
                  <li>
                    In <strong>Project Settings</strong> check <em>Show &quot;appsscript.json&quot; manifest file</em> and ensure <code>oauthScopes</code> includes{' '}
                    <code>https://www.googleapis.com/auth/spreadsheets</code> and <code>https://www.googleapis.com/auth/script.send_mail</code>.
                  </li>
                  <li>
                    Run <code>authorizeMailPermissions()</code> in the Apps Script editor and approve the Gmail/MailApp consent prompt, then run <code>setupFixMyCampus()</code>.
                  </li>
                  <li>
                    Publish via <strong>Deploy &gt; Manage deployments &gt; Edit &gt; New version</strong> (Execute as: Me, Who has access: Anyone).
                  </li>
                  <li>
                    Click <strong>&quot;Test Connection&quot;</strong> above, confirm <strong>MailApp Authorized</strong>, and verify delivery using <strong>Send Test Email</strong>.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === 'live-sheet' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Live Records from Google Sheets (`{selectedSheetTab}` Sheet)
                  </h4>
                  <p className="text-xs text-slate-500">
                    Direct live data retrieved from your spreadsheet via Google Apps Script.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isFetchingSheetTickets || !webAppUrl.trim()}
                  onClick={() => fetchLiveSheetRecords(webAppUrl, selectedSheetTab)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-50 rounded-md flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${isFetchingSheetTickets ? 'animate-spin' : ''}`} />
                  <span>{isFetchingSheetTickets ? 'Querying Sheet...' : 'Refresh Sheet Data'}</span>
                </button>
              </div>

              {/* Sub-tab switcher for the 5 database sheets */}
              <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
                {(['Tickets', 'DepartmentDirectory', 'NotificationLogs', 'ResolutionEvidence', 'AuditLogs'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setSelectedSheetTab(tab);
                      fetchLiveSheetRecords(webAppUrl, tab);
                    }}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                      selectedSheetTab === tab
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {sheetFetchError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-md text-xs">
                  {sheetFetchError}
                </div>
              )}

              {sheetTickets === null && !isFetchingSheetTickets && !sheetFetchError && (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-lg">
                  <Database className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-600 font-medium">
                    {webAppUrl.trim()
                      ? `Click below to query records from your live ${selectedSheetTab} sheet`
                      : 'Configure your Web App URL on the Backend URL tab first.'}
                  </p>
                  {webAppUrl.trim() && (
                    <button
                      type="button"
                      onClick={() => fetchLiveSheetRecords(webAppUrl, selectedSheetTab)}
                      className="mt-3 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-xs"
                    >
                      Query `{selectedSheetTab}` Now
                    </button>
                  )}
                </div>
              )}

              {sheetTickets && sheetTickets.length === 0 && (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-600">No records found in the `{selectedSheetTab}` sheet.</p>
                </div>
              )}

              {sheetTickets && sheetTickets.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="max-h-72 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0 border-b border-slate-200">
                        <tr>
                          {Object.keys(sheetTickets[0]).map((colKey) => (
                            <th key={colKey} className="px-3 py-2 whitespace-nowrap">
                              {colKey}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {sheetTickets.map((row: any, idx: number) => {
                          const keys = Object.keys(sheetTickets[0]);
                          return (
                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                              {keys.map((k) => {
                                const val = row[k];
                                const isId = k.toLowerCase().includes('id');
                                const isStatus = k.toLowerCase() === 'status';
                                const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');

                                return (
                                  <td
                                    key={k}
                                    className={`px-3 py-2 whitespace-nowrap text-xs ${
                                      isId
                                        ? 'font-mono font-bold text-blue-700'
                                        : isStatus
                                        ? 'font-semibold'
                                        : 'text-slate-700'
                                    }`}
                                  >
                                    {isStatus ? (
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                          strVal === 'SENT' || strVal === 'Resolved' || strVal === 'Closed'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : strVal === 'FAILED'
                                            ? 'bg-rose-100 text-rose-800'
                                            : strVal === 'SKIPPED'
                                            ? 'bg-amber-100 text-amber-800'
                                            : strVal === 'PENDING'
                                            ? 'bg-sky-100 text-sky-800'
                                            : 'bg-blue-100 text-blue-800'
                                        }`}
                                      >
                                        {strVal}
                                      </span>
                                    ) : (
                                      <span className="truncate max-w-xs block" title={strVal}>
                                        {strVal}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex justify-between items-center">
                    <span>Retrieved {sheetTickets.length} rows directly from `{selectedSheetTab}` sheet</span>
                    <span className="text-emerald-700 font-medium">✓ Live sheet confirmed</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'payload' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600 font-medium">
                  Columns structured for automatic Google Sheets mapping:
                </span>
                <button
                  type="button"
                  disabled={tickets.length === 0}
                  onClick={handleDownloadCSV}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Live CSV for Google Sheets</span>
                </button>
              </div>

              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-72">
                {JSON.stringify(sheetsPayload.slice(0, 3), null, 2)}
              </pre>
              <p className="text-[11px] text-slate-500">
                *Showing first 3 records of {tickets.length} for inspection. Clicking &quot;Download Live CSV&quot; exports all tickets safely.
              </p>
            </div>
          )}

          {activeTab === 'appsscript' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed">
                <strong>Important:</strong> Updating FixMyCampus here does not automatically overwrite your external Google Apps Script project on{' '}
                <code>script.google.com</code>. Copy or download this complete <code>Code.gs</code>, replace your existing <code>Code.gs</code> content, run{' '}
                <code>authorizeMailPermissions()</code> from the Apps Script function dropdown, then publish{' '}
                <strong>Deploy &gt; Manage deployments &gt; Edit &gt; New version</strong>.
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-600 font-medium">
                    Complete Google Apps Script Backend (`Code.gs`):
                  </span>
                  {sampleAppsScriptCode.includes('function authorizeMailPermissions(') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Includes authorizeMailPermissions()</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([sampleAppsScriptCode], { type: 'text/plain;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'Code.gs';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Code.gs</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-1.5 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied Code!' : 'Copy Apps Script'}</span>
                  </button>
                </div>
              </div>

              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-72 leading-relaxed">
                {sampleAppsScriptCode}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs">
          <span className="text-slate-500">
            FixMyCampus 2.0 Backend Configuration
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium rounded transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
