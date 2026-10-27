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
  ExternalLink,
  ShieldAlert,
  Database,
  RefreshCw,
} from 'lucide-react';
import { CampusTicket } from '../types/campus';
import { storageService } from '../services/storageService';
import { APPS_SCRIPT_SOURCE } from '../data/appsScriptCode';

interface GoogleSheetsIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tickets: CampusTicket[];
  onBackendUrlUpdated?: (url: string) => void;
}

export const GoogleSheetsIntegrationModal: React.FC<GoogleSheetsIntegrationModalProps> = ({
  isOpen,
  onClose,
  tickets,
  onBackendUrlUpdated,
}) => {
  const DEFAULT_DEPLOYED_URL =
    'https://script.google.com/macros/s/AKfycbyx33XJsuqoWM27AoW7sFtEIdwjNldHFvdQX3jtu6EioZBxb_2oRzqRDFIyz-wPEMlUSA/exec';

  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'live-sheet' | 'payload' | 'appsscript'>('config');

  // Backend URL configuration
  const [webAppUrl, setWebAppUrl] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
    details?: string;
  }>({
    status: 'idle',
    message: '',
  });

  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Live Sheet tickets inspector
  const [selectedSheetTab, setSelectedSheetTab] = useState<'Tickets' | 'DepartmentDirectory' | 'NotificationLogs' | 'ResolutionEvidence' | 'AuditLogs'>('Tickets');
  const [isFetchingSheetTickets, setIsFetchingSheetTickets] = useState(false);
  const [sheetTickets, setSheetTickets] = useState<any[] | null>(null);
  const [sheetFetchError, setSheetFetchError] = useState<string | null>(null);

  // Load configured backend URL on open
  useEffect(() => {
    if (isOpen) {
      let saved = storageService.getBackendUrl();
      if (!saved) {
        // Pre-fill with detected deployed Web App URL
        saved = DEFAULT_DEPLOYED_URL;
        storageService.setBackendUrl(saved);
        if (onBackendUrlUpdated) onBackendUrlUpdated(saved);
      }
      setWebAppUrl(saved);
      if (saved) {
        handleTestConnection(saved);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sheetsPayload = storageService.exportToSheetsPayload(tickets);

  const handleSaveUrl = (urlToSave?: string) => {
    const trimmed = (urlToSave !== undefined ? urlToSave : webAppUrl).trim();
    setWebAppUrl(trimmed);
    storageService.setBackendUrl(trimmed);
    if (onBackendUrlUpdated) {
      onBackendUrlUpdated(trimmed);
    }
    if (trimmed) {
      handleTestConnection(trimmed);
    } else {
      setTestResult({
        status: 'idle',
        message: 'Backend URL cleared. System returned to local demo mode.',
      });
      setSheetTickets(null);
    }
  };

  const handleTestConnection = async (urlToTest?: string) => {
    const target = (urlToTest || webAppUrl).trim();
    if (!target) {
      setTestResult({
        status: 'error',
        message: 'Please paste your Google Apps Script Web App URL first.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult({ status: 'idle', message: 'Testing connection to Google Apps Script backend (action: health)...' });

    const result = await storageService.testBackendConnection(target);
    setIsTesting(false);

    if (result.success) {
      setTestResult({
        status: 'success',
        message: result.message || 'Connected successfully to live Google Apps Script backend.',
        details: typeof result.details === 'object' ? JSON.stringify(result.details) : result.details,
      });
      storageService.setBackendUrl(target);
      if (onBackendUrlUpdated) onBackendUrlUpdated(target);
      // Automatically refresh live sheet records
      fetchLiveSheetRecords(target);
    } else {
      setTestResult({
        status: 'error',
        message: result.message || 'Backend connection failed.',
        details: typeof result.details === 'object' ? JSON.stringify(result.details) : result.details,
      });
    }
  };

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

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sampleAppsScriptCode);
    setCopied(true);
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
      `"${item.ticket_id}"`,
      `"${item.timestamp}"`,
      `"${item.reporter}"`,
      `"${item.building}"`,
      `"${item.room}"`,
      `"${item.category}"`,
      `"${item.priority}"`,
      `"${item.status}"`,
      `"${item.assigned_to}"`,
      `"${item.coordinator}"`,
      `"${item.summary.replace(/"/g, '""')}"`,
      `"${item.resolved_at}"`,
      `"${item.resolved_by}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `FixMyCampus_Tickets_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
                Google Sheets & Google Apps Script Backend Settings
              </h2>
              <p className="text-xs text-slate-500">
                Connect your deployed Google Apps Script Web App to log live tickets directly to your Google Sheet.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Backend Connection Indicator Bar */}
        <div className="px-6 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Backend Status:</span>
            {testResult.status === 'success' ? (
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

          <div className="text-[11px] text-slate-400 font-mono">
            {webAppUrl ? 'Custom Web App URL configured' : 'No Web App URL set'}
          </div>
        </div>

        {/* Tab switch */}
        <div className="px-6 pt-3 border-b border-slate-200 flex items-center gap-4 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('config')}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'config'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>Backend URL & Live Sync</span>
          </button>
          <button
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Deployed Google Apps Script Web App URL
                    </label>
                    {webAppUrl !== DEFAULT_DEPLOYED_URL && (
                      <button
                        type="button"
                        onClick={() => handleSaveUrl(DEFAULT_DEPLOYED_URL)}
                        className="text-[11px] text-blue-600 hover:underline font-medium"
                      >
                        Reset to Deployed Backend URL
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    Paste your deployment URL (starts with{' '}
                    <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded">https://script.google.com/macros/s/.../exec</code>
                    ). The application will forward new ticket submissions and verify backend delivery.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={webAppUrl}
                      onChange={(e) => setWebAppUrl(e.target.value)}
                      placeholder="https://script.google.com/macros/s/AKfycbx.../exec"
                      className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      <span>{isTesting ? 'Pinging (action: health)...' : 'Test Connection'}</span>
                    </button>
                  </div>
                </div>

                {/* Status Feedback Result */}
                {testResult.message && (
                  <div
                    className={`p-3 rounded-md text-xs border ${
                      testResult.status === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : testResult.status === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      {testResult.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                      {testResult.status === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                      <span>{testResult.message}</span>
                    </div>
                    {testResult.details && (
                      <p className="mt-1 text-[11px] font-mono text-slate-600 truncate">
                        Response: {testResult.details}
                      </p>
                    )}
                  </div>
                )}
              </div>

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
                  How to test ticket submission end to end:
                </h5>
                <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed">
                  <li>
                    Paste your deployed Google Apps Script Web App URL into the box above and click <strong>&quot;Save URL&quot;</strong>.
                  </li>
                  <li>
                    Click <strong>&quot;Test Connection&quot;</strong> to confirm that your Google Sheet script responds with HTTP 200.
                  </li>
                  <li>
                    <em>Spreadsheet Binding Note:</em> If your Apps Script shows <code>Cannot read properties of null (reading &apos;getSheetByName&apos;)</code>, open <strong>Apps Script Code</strong> tab, copy the updated <code>Code.gs</code>, paste your Google Sheet ID into <code>var SPREADSHEET_ID = &apos;YOUR_ID&apos;;</code>, and re-deploy.
                  </li>
                  <li>
                    Close this modal, click <strong>&quot;+ Report Campus Issue&quot;</strong> in the top header, fill in a problem (or click a Demo Filler like <em>Demo: Projector Flicker</em>), and click <strong>&quot;Submit &amp; Dispatch Ticket&quot;</strong>.
                  </li>
                  <li>
                    The app will transmit the ticket payload to your Google Sheet and show a green confirmation toast upon successful receipt by your backend!
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
                  <p className="text-xs text-slate-600 font-medium">Click below to query records from your live `{selectedSheetTab}` sheet</p>
                  <button
                    onClick={() => fetchLiveSheetRecords(webAppUrl, selectedSheetTab)}
                    className="mt-3 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-xs"
                  >
                    Query `{selectedSheetTab}` Now
                  </button>
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
                  onClick={handleDownloadCSV}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Live CSV for Google Sheets</span>
                </button>
              </div>

              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-72">
                {JSON.stringify(sheetsPayload.slice(0, 3), null, 2)}
              </pre>
              <p className="text-[11px] text-slate-500">
                *Showing first 3 records of {tickets.length} for inspection. Clicking &quot;Download Live CSV&quot; exports all tickets.
              </p>
            </div>
          )}

          {activeTab === 'appsscript' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600 font-medium">
                  Deploy this snippet into Extensions &gt; Apps Script in your Google Sheet:
                </span>
                <button
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied Code!' : 'Copy Apps Script'}</span>
                </button>
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
