import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { SimulatedNotification } from '../types/campus';
import { storageService } from '../services/storageService';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: SimulatedNotification[];
  onSelectTicket?: (ticketId: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onSelectTicket,
}) => {
  const [activeTab, setActiveTab] = useState<'live-sheet' | 'simulated'>('live-sheet');
  const [filterRole, setFilterRole] = useState<string>('all');

  // Live Sheet NotificationLogs state
  const [liveLogs, setLiveLogs] = useState<any[] | null>(null);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const backendUrl = storageService.getBackendUrl();

  useEffect(() => {
    if (isOpen) {
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
      } else if (res.success && Array.isArray((res as any).logs)) {
        setLiveLogs((res as any).logs);
      } else {
        setLiveError(res.message || 'Could not fetch NotificationLogs from Google Sheets.');
      }
    } catch (err: any) {
      setIsLoadingLive(false);
      setLiveError(err.message || 'Failed to connect to Google Sheets backend.');
    }
  };

  if (!isOpen) return null;

  const filteredSimulated = notifications.filter(
    (n) => filterRole === 'all' || n.recipientRole === filterRole
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl my-8 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Department Dispatch & Notification Logs
              </h2>
              <p className="text-xs text-slate-500">
                Automated email alerts dispatched via Google Apps Script MailApp to department coordinators.
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

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 bg-slate-100 border-b border-slate-200">
          <div className="flex space-x-2">
            <button
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
              onClick={() => setActiveTab('simulated')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                activeTab === 'simulated'
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-slate-500" />
              <span>Simulated Queue ({notifications.length})</span>
            </button>
          </div>

          {activeTab === 'live-sheet' && (
            <button
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
            ) : liveLogs && liveLogs.length > 0 ? (
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {liveLogs.map((row: any, idx: number) => {
                        const ticketId = row.TicketID || row.TicketId || row.ticketId || `Log-${idx + 1}`;
                        const timestamp = row.Timestamp || row.timestamp || '-';
                        const dept = row.Department || row.department || '-';
                        const recipient = row.Recipient || row.recipient || row.ResponsibleEmail || '-';
                        const cc = row.CC || row.cc || 'None';
                        const status = String(row.Status || row.status || 'SENT').toUpperCase();
                        const details = row.Details || row.details || row.Message || '-';

                        const isSent = status === 'SENT';
                        const isFailed = status === 'FAILED';

                        return (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2 font-mono font-bold text-blue-700 whitespace-nowrap">
                              {onSelectTicket && ticketId.startsWith('FMC-') ? (
                                <button
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
                            <td className="px-3 py-2 text-slate-600 text-[11px] max-w-xs truncate" title={details}>
                              {details}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
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
                  These records simulate alerts in browser memory. To inspect authoritative dispatches via MailApp, switch to the <strong>Live Google Sheets Logs</strong> tab.
                </p>
              </div>
            </div>

            {/* Filter controls */}
            <div className="px-6 py-2 bg-slate-50/60 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                Showing <span className="font-mono tabular-nums font-bold text-slate-800">{filteredSimulated.length}</span> staged records
              </span>

              <div className="flex items-center gap-2 text-xs">
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
                    className="p-4 bg-white border border-slate-200 rounded-lg space-y-2 hover:border-slate-300 transition-colors shadow-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
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

                        <span className="font-bold text-slate-800">{item.recipientRole}:</span>
                        <span className="text-slate-700">{item.recipientName}</span>
                        <span className="text-slate-400 text-[11px] font-mono">({item.recipientEmail})</span>
                      </div>

                      <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {item.timestamp}
                      </span>
                    </div>

                    <div className="text-xs">
                      <div className="font-semibold text-slate-900 mb-1 flex items-center justify-between">
                        <span>{item.subject}</span>
                        {onSelectTicket && item.ticketId && (
                          <button
                            onClick={() => {
                              onSelectTicket(item.ticketId);
                              onClose();
                            }}
                            className="text-blue-600 hover:text-blue-800 font-mono text-[11px] flex items-center gap-1"
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
                      <span className="text-emerald-700 font-medium">✓ Auto-Triggered</span>
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
            FixMyCampus 2.0 Dispatch Queue &bull; Authoritative Notification Tracking
          </span>
          <button
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
