import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Bell,
  Mail,
  Smartphone,
  CheckCircle,
  AlertCircle,
  Clock,
  ShieldAlert,
  ExternalLink,
  RefreshCw,
  Database,
  Search,
  CheckCheck,
  RotateCw,
} from 'lucide-react';
import { SimulatedNotification } from '../types/campus';
import { storageService } from '../services/storageService';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: SimulatedNotification[];
  liveLogsProp?: any[];
  mailAuthorized?: boolean | null;
  mailDiagnostic?: string;
  onLiveLogsUpdated?: (logs: any[]) => void;
  onRetryNotification?: (ticketId: string) => Promise<{ success: boolean; message: string }>;
  onSelectTicket?: (ticketId: string) => void;
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  notifications,
  liveLogsProp,
  mailAuthorized = null,
  mailDiagnostic,
  onLiveLogsUpdated,
  onRetryNotification,
  onSelectTicket,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}) => {
  const [activeTab, setActiveTab] = useState<'live-sheet' | 'simulated'>('live-sheet');
  const [filterRole, setFilterRole] = useState<string>('all');

  // Live Sheet NotificationLogs state & filters
  const [liveLogs, setLiveLogs] = useState<any[] | null>(liveLogsProp || null);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveSearch, setLiveSearch] = useState('');
  const [liveStatusFilter, setLiveStatusFilter] = useState<'all' | 'SENT' | 'FAILED' | 'SKIPPED' | 'PENDING'>('all');
  const [retryingRowKey, setRetryingRowKey] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const backendUrl = storageService.getBackendUrl();

  useEffect(() => {
    if (Array.isArray(liveLogsProp) && liveLogsProp.length > 0) {
      setLiveLogs(liveLogsProp);
    }
  }, [liveLogsProp]);

  useEffect(() => {
    if (isOpen) {
      setRetryFeedback(null);
      if (backendUrl) {
        setActiveTab('live-sheet');
        fetchLiveLogs();
      } else {
        setActiveTab('simulated');
      }
    }
  }, [isOpen, backendUrl]);

  const fetchLiveLogs = async () => {
    const url = storageService.getBackendUrl();
    if (!url) {
      setLiveError('No Google Apps Script Web App URL configured. Please configure it in Google Sheets Sync.');
      return;
    }

    setIsLoadingLive(true);
    setLiveError(null);

    try {
      const res = await storageService.fetchBackendLogs(url, 'NotificationLogs');
      setIsLoadingLive(false);

      if (res.success && Array.isArray(res.notificationLogs)) {
        setLiveLogs(res.notificationLogs);
        if (onLiveLogsUpdated) onLiveLogsUpdated(res.notificationLogs);
      } else if (res.success && Array.isArray((res as any).logs)) {
        setLiveLogs((res as any).logs);
        if (onLiveLogsUpdated) onLiveLogsUpdated((res as any).logs);
      } else {
        setLiveError(res.message || 'Could not fetch NotificationLogs from Google Sheets.');
      }
    } catch (err: any) {
      setIsLoadingLive(false);
      setLiveError(err.message || 'Failed to connect to Google Sheets backend.');
    }
  };

  const handleRetryRow = async (ticketId: string, rowKey: string) => {
    if (!ticketId || retryingRowKey) return;
    setRetryingRowKey(rowKey);
    setRetryFeedback(null);
    try {
      const res = onRetryNotification
        ? await onRetryNotification(ticketId)
        : await storageService.retryNotificationOnBackend(ticketId);
      setRetryFeedback({ success: res.success, message: res.message });
      await fetchLiveLogs();
    } finally {
      setRetryingRowKey(null);
    }
  };

  const filteredLiveLogs = useMemo(() => {
    if (!liveLogs) return null;
    const q = liveSearch.trim().toLowerCase();
    return liveLogs.filter((row: any) => {
      const ticketId = String(row.TicketID || row.TicketId || row.ticketId || '').toLowerCase();
      const dept = String(row.Department || row.department || '').toLowerCase();
      const recipient = String(row.Recipient || row.recipient || row.ResponsibleEmail || '').toLowerCase();
      const details = String(row.Details || row.details || row.Message || row.Subject || '').toLowerCase();
      const status = String(row.Status || row.status || row.Result || row.result || 'SENT').toUpperCase();

      const matchesStatus = liveStatusFilter === 'all' || status === liveStatusFilter;
      const matchesQuery =
        !q ||
        ticketId.includes(q) ||
        dept.includes(q) ||
        recipient.includes(q) ||
        details.includes(q);

      return matchesStatus && matchesQuery;
    });
  }, [liveLogs, liveSearch, liveStatusFilter]);

  if (!isOpen) return null;

  const filteredSimulated = notifications.filter(
    (n) => filterRole === 'all' || n.recipientRole === filterRole
  );
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl my-8 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Department Dispatch &amp; Notification Logs
              </h2>
              <p className="text-xs text-slate-500">
                Automated email alerts dispatched via Google Apps Script MailApp to department coordinators.
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

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 bg-slate-100 border-b border-slate-200">
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setActiveTab('live-sheet')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                activeTab === 'live-sheet'
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-blue-600" />
              <span>Live Google Sheets Logs</span>
              {liveLogs && (
                <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded-full font-mono">
                  {liveLogs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('simulated')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                activeTab === 'simulated'
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-slate-500" />
              <span>Simulated Local Queue ({unreadCount} unread / {notifications.length})</span>
            </button>
          </div>

          {activeTab === 'live-sheet' && (
            <button
              type="button"
              onClick={fetchLiveLogs}
              disabled={isLoadingLive || !backendUrl}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-xs flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 text-blue-600 ${isLoadingLive ? 'animate-spin' : ''}`} />
              <span>{isLoadingLive ? 'Fetching...' : 'Refresh Logs'}</span>
            </button>
          )}
        </div>

        {/* LIVE SHEET TAB */}
        {activeTab === 'live-sheet' && (
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {!backendUrl ? (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-lg">
                <Database className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">Google Sheets Backend Not Configured</p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Configure your Google Apps Script Web App URL in the <strong>Google Sheets Sync</strong> panel to enable real-time delivery logging and MailApp dispatches.
                </p>
              </div>
            ) : liveError ? (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs space-y-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Unable to fetch NotificationLogs from Google Sheet</span>
                </div>
                <p className="text-[11px] text-rose-700">{liveError}</p>
                <button
                  type="button"
                  onClick={fetchLiveLogs}
                  className="px-3 py-1 bg-white border border-rose-300 text-rose-800 hover:bg-rose-100 rounded text-xs font-medium shadow-xs"
                >
                  Retry Connection
                </button>
              </div>
            ) : liveLogs === null && isLoadingLive ? (
              <div className="p-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
                <span>Reading NotificationLogs sheet from Google Sheets...</span>
              </div>
            ) : liveLogs && liveLogs.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                No notification logs recorded in the sheet yet. Submit an issue to generate an authoritative MailApp dispatch log.
              </div>
            ) : filteredLiveLogs ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={liveSearch}
                      onChange={(e) => setLiveSearch(e.target.value)}
                      placeholder="Filter live logs by ticket ID, department, recipient, or details..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <select
                    value={liveStatusFilter}
                    onChange={(e) => setLiveStatusFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-medium text-slate-700"
                  >
                    <option value="all">All Delivery Results</option>
                    <option value="SENT">SENT</option>
                    <option value="FAILED">FAILED</option>
                    <option value="SKIPPED">SKIPPED</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </div>

                {mailAuthorized === false && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Google Apps Script Email Permission Not Authorized</span>
                    </div>
                    <p className="text-[11px] text-rose-800 leading-relaxed">
                      {mailDiagnostic ||
                        'MailApp.sendEmail requires Gmail authorization. Open Extensions > Apps Script, ensure appsscript.json includes https://www.googleapis.com/auth/script.send_mail, run authorizeMailPermissions(), approve OAuth consent, then publish Deploy > Manage deployments > New version.'}
                    </p>
                  </div>
                )}

                {retryFeedback && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs ${
                      retryFeedback.success
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {retryFeedback.message}
                  </div>
                )}

                {filteredLiveLogs.length === 0 ? (
                  <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                    No notification logs match your filter.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="px-3 py-2.5">Ticket ID</th>
                            <th className="px-3 py-2.5">Timestamp</th>
                            <th className="px-3 py-2.5">Department</th>
                            <th className="px-3 py-2.5">Recipient (Responsible)</th>
                            <th className="px-3 py-2.5">CC (Head)</th>
                            <th className="px-3 py-2.5">Dispatch Result</th>
                            <th className="px-3 py-2.5">Diagnostic Details</th>
                            <th className="px-3 py-2.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {filteredLiveLogs.map((row: any, idx: number) => {
                            const ticketId = String(row.TicketID || row.TicketId || row.ticketId || `Log-${idx + 1}`);
                            const timestamp = row.Timestamp || row.timestamp || '-';
                            const dept = row.Department || row.department || '-';
                            const recipient = row.Recipient || row.recipient || row.ResponsibleEmail || '-';
                            const cc = row.CC || row.cc || 'None';
                            const status = String(row.Status || row.status || row.Result || row.result || 'SENT').toUpperCase();
                            const subject = row.Subject || row.subject || '';
                            const details = row.Details || row.details || row.Message || (subject || '-');

                            const isSent = status === 'SENT';
                            const isFailed = status === 'FAILED';
                            const rowKey = `${ticketId}-${idx}`;
                            const isRetrying = retryingRowKey === rowKey;

                            return (
                              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                <td className="px-3 py-2 font-mono font-bold text-blue-700 whitespace-nowrap">
                                  {onSelectTicket && ticketId.startsWith('FMC-') ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onSelectTicket(ticketId);
                                        onClose();
                                      }}
                                      className="hover:underline flex items-center gap-1"
                                    >
                                      <span>{ticketId}</span>
                                      <ExternalLink className="w-3 h-3 text-slate-400" />
                                    </button>
                                  ) : (
                                    ticketId
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-[11px] font-mono">
                                  {timestamp}
                                </td>
                                <td className="px-3 py-2 text-slate-800 font-medium whitespace-nowrap">
                                  {dept}
                                </td>
                                <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">
                                  {recipient}
                                </td>
                                <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap text-[11px]">
                                  {cc}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                      isSent
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                        : isFailed
                                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                        : status === 'PENDING'
                                        ? 'bg-sky-100 text-sky-800 border border-sky-200'
                                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                                    }`}
                                  >
                                    {isSent ? (
                                      <CheckCircle className="w-3 h-3" />
                                    ) : isFailed ? (
                                      <AlertCircle className="w-3 h-3" />
                                    ) : (
                                      <Clock className="w-3 h-3" />
                                    )}
                                    <span>{status}</span>
                                  </span>
                                </td>
                                <td
                                  className="px-3 py-2 text-slate-600 text-[11px] max-w-xs truncate"
                                  title={subject ? `${subject}\n${details}` : details}
                                >
                                  {details}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  {(status === 'FAILED' || status === 'SKIPPED') && ticketId.startsWith('FMC-') ? (
                                    <button
                                      type="button"
                                      disabled={!!retryingRowKey}
                                      onClick={() => handleRetryRow(ticketId, rowKey)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded disabled:opacity-50"
                                    >
                                      <RotateCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                                      <span>{isRetrying ? 'Sending...' : 'Retry Send'}</span>
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">—</span>
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
              </>
            ) : null}
          </div>
        )}

        {/* SIMULATED QUEUE TAB */}
        {activeTab === 'simulated' && (
          <div className="space-y-4">
            {/* Disclaimer Banner */}
            <div className="px-6 py-3 bg-amber-50/80 border-b border-amber-200 flex items-start gap-2.5 text-amber-900 text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold uppercase tracking-wider text-[11px] text-amber-950">
                  Local Simulation Queue
                </span>
                <p className="text-amber-800 leading-relaxed">
                  These records simulate alerts in browser memory during Demo Mode. To inspect authoritative MailApp dispatches, switch to the <strong>Live Google Sheets Logs</strong> tab.
                </p>
              </div>
            </div>

            {/* Filter & Read-State Controls */}
            <div className="px-6 py-2 bg-slate-50/60 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500 font-medium">
                Showing <span className="font-mono tabular-nums font-bold text-slate-800">{filteredSimulated.length}</span> staged records ({unreadCount} unread)
              </span>

              <div className="flex items-center gap-3 text-xs">
                {unreadCount > 0 && onMarkAllNotificationsRead && (
                  <button
                    type="button"
                    onClick={onMarkAllNotificationsRead}
                    className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Mark All Read</span>
                  </button>
                )}

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Recipient Filter:</span>
                  <select
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded font-medium text-slate-700"
                  >
                    <option value="all">All Roles</option>
                    <option value="Coordinator">Lead Coordinators</option>
                    <option value="Department Head">Department Heads</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Simulated Notification List */}
            <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
              {filteredSimulated.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  No simulated notifications in this queue.
                </div>
              ) : (
                filteredSimulated.map((item) => (
                  <div
                    key={item.id}
                    className={`p-4 border rounded-lg space-y-2 transition-colors shadow-xs ${
                      item.isRead
                        ? 'bg-slate-50/60 border-slate-200 opacity-85'
                        : 'bg-white border-blue-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs pb-2 border-b border-slate-100">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.channel.includes('SMS') ? (
                          <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium text-[11px] border border-amber-200">
                            <Smartphone className="w-3.5 h-3.5" />
                            SMS Dispatch
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-medium text-[11px] border border-blue-200">
                            <Mail className="w-3.5 h-3.5" />
                            Email Dispatch
                          </span>
                        )}

                        {!item.isRead && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded">
                            Unread
                          </span>
                        )}

                        <span className="font-bold text-slate-800">{item.recipientRole}:</span>
                        <span className="text-slate-700">{item.recipientName}</span>
                        <span className="text-slate-400 text-[11px] font-mono">({item.recipientEmail})</span>
                      </div>

                      <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {item.timestamp}
                      </span>
                    </div>

                    <div className="text-xs">
                      <div className="font-semibold text-slate-900 mb-1 flex items-center justify-between gap-2">
                        <span>{item.subject}</span>
                        {onSelectTicket && item.ticketId && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectTicket(item.ticketId);
                              onClose();
                            }}
                            className="text-blue-600 hover:text-blue-800 font-mono text-[11px] flex items-center gap-1 shrink-0"
                          >
                            <span>Ticket {item.ticketId}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200/60 leading-relaxed font-sans text-xs">
                        {item.body}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                      <span>Simulation Status: Staged in Local Demo Queue</span>
                      {!item.isRead && onMarkNotificationRead ? (
                        <button
                          type="button"
                          onClick={() => onMarkNotificationRead(item.id)}
                          className="text-blue-700 hover:underline font-semibold"
                        >
                          Mark as Read
                        </button>
                      ) : (
                        <span className="text-emerald-700 font-medium">✓ Read</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs">
          <span className="text-slate-500">
            FixMyCampus 2.0 Dispatch Queue &bull; Notification Tracking
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
