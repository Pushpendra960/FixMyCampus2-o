import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { RoomHistoryView } from './components/RoomHistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { ReportIssueModal } from './components/ReportIssueModal';
import { TicketDetailModal } from './components/TicketDetailModal';
import { NotificationsModal } from './components/NotificationsModal';
import { GoogleSheetsIntegrationModal } from './components/GoogleSheetsIntegrationModal';
import {
  BackendConnectionStatus,
  CampusTicket,
  DepartmentDirectoryRow,
  DepartmentDirectorySummary,
  DepartmentInfo,
  RoomRecord,
  SimulatedNotification,
} from './types/campus';
import { storageService } from './services/storageService';
import { DEPARTMENTS } from './data/mockData';

export default function App() {
  const [tickets, setTickets] = useState<CampusTicket[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [notifications, setNotifications] = useState<SimulatedNotification[]>([]);
  const [liveNotificationLogs, setLiveNotificationLogs] = useState<any[]>([]);
  const [mailStatus, setMailStatus] = useState<{
    authorized: boolean | null;
    diagnostic?: string;
    remainingQuota?: number | null;
  }>({
    authorized: null,
  });
  const [departmentsMap, setDepartmentsMap] = useState<Record<string, DepartmentInfo>>(DEPARTMENTS);
  const [rawDepartments, setRawDepartments] = useState<DepartmentDirectoryRow[]>([]);
  const [deptEmailSummary, setDeptEmailSummary] = useState<DepartmentDirectorySummary | null>(null);

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'tickets' | 'room-history' | 'analytics'>('dashboard');
  const [focusedRoomNumber, setFocusedRoomNumber] = useState<string | undefined>(undefined);

  // Modals
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportInitialLocation, setReportInitialLocation] = useState<{ building?: string; room?: string }>({});
  const [selectedTicket, setSelectedTicket] = useState<CampusTicket | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);

  // Toast with proper timer cleanup
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  } | null>(null);

  const [backendUrl, setBackendUrl] = useState<string>(storageService.getBackendUrl());
  const [backendStatus, setBackendStatus] = useState<BackendConnectionStatus>(
    storageService.getBackendUrl() ? 'connecting' : 'demo'
  );
  const [isLoadingTickets, setIsLoadingTickets] = useState<boolean>(!!storageService.getBackendUrl());
  const [backendError, setBackendError] = useState<string | null>(null);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const applyDepartmentsSnapshot = useCallback(
    (rows: DepartmentDirectoryRow[], summary?: DepartmentDirectorySummary | null) => {
      setRawDepartments(rows);
      if (summary !== undefined) {
        setDeptEmailSummary(summary);
      }
      if (rows.length > 0) {
        const merged: Record<string, DepartmentInfo> = { ...DEPARTMENTS };
        for (const row of rows) {
          const name = String(row.Department || row.department || row.Name || '').trim();
          if (!name) continue;
          const base = merged[name] || DEPARTMENTS['General Administration'];
          merged[name] = {
            ...base,
            name,
            leadCoordinator: String(
              row.ResponsibleName || row.ResponsiblePerson || row.Coordinator || base.leadCoordinator
            ).trim(),
            coordinatorEmail: String(
              row.ResponsibleEmail || row.Email || ''
            ).trim(),
            headName: String(row.HeadName || row.DepartmentHead || base.headName).trim(),
            headEmail: String(
              row.DepartmentHeadEmail || row.HeadEmail || row.CCEmail || ''
            ).trim(),
          };
        }
        setDepartmentsMap(merged);
      }
    },
    []
  );

  const syncDepartmentsFromBackend = useCallback(
    async (url: string) => {
      const deptRes = await storageService.fetchDepartments(url);
      if (deptRes.success && Array.isArray(deptRes.departments)) {
        applyDepartmentsSnapshot(deptRes.departments, deptRes.summary || null);
      }
    },
    [applyDepartmentsSnapshot]
  );

  const loadLiveBackendData = useCallback(
    async (activeUrl: string, announceSuccess = false) => {
      setBackendStatus('connecting');
      setIsLoadingTickets(true);
      setBackendError(null);

      try {
        const healthRes = await storageService.testBackendConnection(activeUrl);
        if (healthRes.details && typeof healthRes.details === 'object') {
          if (typeof healthRes.details.mailAuthorized === 'boolean') {
            setMailStatus({
              authorized: healthRes.details.mailAuthorized,
              diagnostic: healthRes.details.mailDiagnostic,
              remainingQuota:
                typeof healthRes.details.mailRemainingQuota === 'number'
                  ? healthRes.details.mailRemainingQuota
                  : null,
            });
          }
          if (healthRes.details.departmentEmailSummary) {
            setDeptEmailSummary(healthRes.details.departmentEmailSummary);
          }
        }
        if (!healthRes.success) {
          const cached = storageService.getLiveCachedTickets();
          setTickets(cached);
          setBackendStatus('error');
          setBackendError(healthRes.message);
          showToast(
            `Google Sheets connection check failed: ${healthRes.message}`,
            'error'
          );
          return;
        }

        const [ticketRes, logsRes] = await Promise.all([
          storageService.fetchBackendTickets(activeUrl),
          storageService.fetchBackendLogs(activeUrl).catch(() => ({
            success: false,
            notificationLogs: [],
            auditLogs: [],
            evidence: [],
          })),
        ]);

        if (ticketRes.success && Array.isArray(ticketRes.tickets)) {
          setBackendStatus('live');
          setBackendError(null);

          const hydrated = logsRes.success
            ? storageService.hydrateTicketsWithLogs(
                ticketRes.tickets,
                logsRes.auditLogs || [],
                logsRes.evidence || []
              )
            : ticketRes.tickets;

          setTickets(hydrated);
          storageService.saveLiveCachedTickets(hydrated);
          if (logsRes.success && Array.isArray(logsRes.notificationLogs)) {
            setLiveNotificationLogs(logsRes.notificationLogs);
          }

          syncDepartmentsFromBackend(activeUrl).catch(() => {});
          if (announceSuccess) {
            showToast(
              `✓ Synchronized ${hydrated.length} live ticket(s) from Google Sheets!`,
              'success'
            );
          }
        } else {
          const cached = storageService.getLiveCachedTickets();
          setTickets(cached);
          setBackendStatus('error');
          setBackendError(ticketRes.message || 'Unable to fetch live tickets from Google Sheets.');
          showToast(
            `Failed to read live tickets: ${ticketRes.message || 'Unknown error'}`,
            'error'
          );
        }
      } catch (err: any) {
        const cached = storageService.getLiveCachedTickets();
        setTickets(cached);
        setBackendStatus('error');
        setBackendError(err?.message || 'Network error reaching Google Apps Script.');
        showToast(`Sheet query failed: ${err?.message || 'Network error'}`, 'error');
      } finally {
        setIsLoadingTickets(false);
      }
    },
    [showToast, syncDepartmentsFromBackend]
  );

  // Strict Live vs Demo initialization on mount
  useEffect(() => {
    const activeUrl = storageService.getBackendUrl();
    if (!activeUrl) {
      setBackendStatus('demo');
      setBackendError(null);
      setIsLoadingTickets(false);
      setTickets(storageService.getTickets());
      setRooms(storageService.getRooms());
      setNotifications(storageService.getNotifications());
      setLiveNotificationLogs([]);
      setMailStatus({ authorized: null });
      return;
    }

    // Live mode: keep demo mock data strictly out of live state while loading
    setRooms([]);
    setTickets([]);
    setNotifications([]);
    setLiveNotificationLogs([]);
    loadLiveBackendData(activeUrl, false);
  }, [loadLiveBackendData]);

  const handleCreateTicket = async (
    newTicketData: CampusTicket
  ): Promise<{ success: boolean; ticketId?: string; message?: string }> => {
    const activeUrl = storageService.getBackendUrl();

    if (activeUrl) {
      showToast('Transmitting ticket to Google Sheets backend...', 'info');
      try {
        const backendRes = await storageService.sendTicketToBackend(newTicketData, activeUrl);
        if (backendRes.success) {
          setBackendStatus('live');
          setBackendError(null);

          const authoritativeId = backendRes.ticketId || storageService.generateNextTicketId(tickets);
          const authoritativeDept = backendRes.department || newTicketData.recommendedDepartment;
          const authoritativeDeptInfo =
            departmentsMap[authoritativeDept] ||
            departmentsMap['General Administration'] ||
            DEPARTMENTS['IT / Audio-Visual Support'];
          const syncedTicket: CampusTicket = {
            ...newTicketData,
            id: authoritativeId,
            recommendedDepartment: authoritativeDept,
            category: (backendRes.category || newTicketData.category) as any,
            priority: (backendRes.priority || newTicketData.priority) as any,
            assignedDepartmentCoordinator:
              authoritativeDeptInfo?.leadCoordinator || newTicketData.assignedDepartmentCoordinator,
            assignedDepartmentHead:
              authoritativeDeptInfo?.headName || newTicketData.assignedDepartmentHead,
            status: (backendRes.requiresManualReview
              ? 'Needs Review'
              : backendRes.status || newTicketData.status) as any,
            updatedAt: new Date().toISOString(),
          };

          setTickets((prev) => {
            const next = [syncedTicket, ...prev.filter((t) => t.id !== authoritativeId)];
            storageService.saveLiveCachedTickets(next);
            return next;
          });

          let notifMsg = '';
          if (backendRes.notification) {
            const n: any = backendRes.notification;
            if (n.status === 'SENT' || n.sent) {
              notifMsg = ` | Email sent to ${n.recipient || 'coordinator'}${n.cc ? ` (CC: ${n.cc})` : ''}`;
            } else if (n.status === 'FAILED') {
              notifMsg = ` | Email dispatch failed: ${n.message}`;
            } else if (n.message) {
              notifMsg = ` | Email skipped: ${n.message}`;
            }
          }
          if (backendRes.reporterNotification) {
            const rn = backendRes.reporterNotification;
            if (rn.sent || rn.status === 'SENT') {
              notifMsg += ` | Confirmation sent to ${rn.recipient}`;
            } else if (rn.status === 'FAILED') {
              notifMsg += ` | Reporter confirmation failed`;
            }
          }

          storageService.fetchBackendLogs(activeUrl, 'NotificationLogs').then((logsRes) => {
            if (logsRes.success && Array.isArray(logsRes.notificationLogs)) {
              setLiveNotificationLogs(logsRes.notificationLogs);
            }
          }).catch(() => {});

          const msg = `✓ Ticket ${syncedTicket.id} saved in Google Sheets [Dept: ${syncedTicket.recommendedDepartment}]${notifMsg}`;
          showToast(msg, 'success');
          return { success: true, ticketId: syncedTicket.id, message: msg };
        }

        const errMsg = backendRes.message || 'Google Sheets backend rejected ticket submission.';
        setBackendStatus('error');
        setBackendError(errMsg);
        showToast(`Submission failed: ${errMsg}`, 'error');
        return { success: false, message: errMsg };
      } catch (err: any) {
        const errMsg = err?.message || 'Network transmission failed.';
        setBackendStatus('error');
        setBackendError(errMsg);
        showToast(`Submission failed: ${errMsg}`, 'error');
        return { success: false, message: errMsg };
      }
    }

    // Demo Mode persistence
    const demoId = storageService.generateNextTicketId(tickets);
    const finalizedTicket: CampusTicket = {
      ...newTicketData,
      id: demoId,
      updatedAt: newTicketData.reportedAt,
    };

    storageService.addTicket(finalizedTicket);
    setTickets(storageService.getTickets());
    setRooms(storageService.getRooms());

    const deptInfo =
      departmentsMap[finalizedTicket.recommendedDepartment] ||
      departmentsMap['General Administration'] ||
      DEPARTMENTS['IT / Audio-Visual Support'];

    const newNotifs: SimulatedNotification[] = [
      {
        id: `notif-${Date.now()}`,
        ticketId: demoId,
        recipientName: deptInfo.leadCoordinator,
        recipientEmail: deptInfo.coordinatorEmail,
        recipientRole: 'Coordinator',
        channel: finalizedTicket.priority === 'Critical' ? 'SMS/Alert (Simulated)' : 'Email (Simulated)',
        subject: `[FixMyCampus] New ${finalizedTicket.priority} Priority Issue: ${finalizedTicket.roomNumber}`,
        body: `${finalizedTicket.isAnonymous ? 'Anonymous Faculty' : finalizedTicket.facultyName} reported: "${finalizedTicket.aiSummary}" in ${finalizedTicket.roomNumber} (${finalizedTicket.building}). Urgency: ${finalizedTicket.urgencyReason}`,
        timestamp: finalizedTicket.reportedAt,
        status: 'Dispatched (Demo)',
        isRead: false,
      },
      {
        id: `notif-${Date.now() + 1}`,
        ticketId: demoId,
        recipientName: deptInfo.headName,
        recipientEmail: deptInfo.headEmail,
        recipientRole: 'Department Head',
        channel: 'Email (Simulated)',
        subject: `[Department Digest] ${finalizedTicket.category} Logged for ${finalizedTicket.roomNumber}`,
        body: `Automated notification: Ticket ${demoId} logged for ${finalizedTicket.roomNumber}.`,
        timestamp: finalizedTicket.reportedAt,
        status: 'Dispatched (Demo)',
        isRead: false,
      },
    ];

    const currentNotifs = storageService.getNotifications();
    const combinedNotifs = [...newNotifs, ...currentNotifs];
    storageService.saveNotifications(combinedNotifs);
    setNotifications(combinedNotifs);

    const msg = `Ticket ${demoId} logged in local demo storage.`;
    showToast(`${msg} Configure your Web App URL in Sheets Sync to persist to Google Sheets.`, 'info');
    return { success: true, ticketId: demoId, message: msg };
  };

  const handleUpdateTicket = async (
    updated: CampusTicket
  ): Promise<{ success: boolean; message?: string }> => {
    const withUpdatedTimestamp: CampusTicket = {
      ...updated,
      updatedAt: new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const activeUrl = storageService.getBackendUrl();
    if (activeUrl) {
      try {
        const previousTicket = tickets.find((t) => t.id === withUpdatedTimestamp.id);
        const previousStatus = previousTicket?.status;
        const syncRes = await storageService.updateTicketStatusOnBackend(
          withUpdatedTimestamp.id,
          withUpdatedTimestamp.status,
          withUpdatedTimestamp.resolution?.notes,
          withUpdatedTimestamp.resolution?.photoUrl,
          activeUrl,
          withUpdatedTimestamp.resolution?.resolvedBy || 'Staff',
          withUpdatedTimestamp.assignedTo,
          previousStatus,
          {
            reporterEmail: withUpdatedTimestamp.isAnonymous
              ? ''
              : withUpdatedTimestamp.facultyEmail || previousTicket?.facultyEmail,
            notifyReporter: withUpdatedTimestamp.notifyReporter !== false,
            isVerified:
              previousStatus === 'Pending Verification' && withUpdatedTimestamp.status === 'Closed',
          }
        );
        if (syncRes.success) {
          setBackendStatus('live');
          setBackendError(null);
          const mergedUpdated: CampusTicket = {
            ...withUpdatedTimestamp,
            updatedAt: syncRes.updatedAt || withUpdatedTimestamp.updatedAt,
            recommendedDepartment: syncRes.department || withUpdatedTimestamp.recommendedDepartment,
            assignedTo: syncRes.assignedTo !== undefined ? (syncRes.assignedTo || undefined) : withUpdatedTimestamp.assignedTo,
            closedAt:
              withUpdatedTimestamp.status === 'Closed'
                ? withUpdatedTimestamp.closedAt || syncRes.updatedAt || new Date().toISOString()
                : withUpdatedTimestamp.closedAt,
          };
          setTickets((prev) => {
            const next = prev.map((t) =>
              t.id === mergedUpdated.id ? mergedUpdated : t
            );
            storageService.saveLiveCachedTickets(next);
            return next;
          });
          setSelectedTicket(mergedUpdated);

          storageService.fetchBackendLogs(activeUrl, 'NotificationLogs').then((logsRes) => {
            if (logsRes.success && Array.isArray(logsRes.notificationLogs)) {
              setLiveNotificationLogs(logsRes.notificationLogs);
            }
          }).catch(() => {});

          let notifSuffix = '';
          if (syncRes.notification) {
            const n = syncRes.notification;
            if (n.sent || n.status === 'SENT') {
              notifSuffix = ` | Notification email sent to ${n.recipient}${n.cc ? ` (CC: ${n.cc})` : ''}`;
            } else if (n.status === 'FAILED') {
              notifSuffix = ` | Email dispatch issue: ${n.message}`;
            } else if (n.status === 'SKIPPED' && n.message) {
              notifSuffix = ` | Email skipped: ${n.message}`;
            }
          }
          const okMsg = `✓ Ticket ${mergedUpdated.id} (${mergedUpdated.status}) synced to Google Sheets.${notifSuffix}`;
          showToast(okMsg, 'success');
          return { success: true, message: okMsg };
        }

        setBackendStatus('error');
        setBackendError(syncRes.message);
        showToast(`⚠️ Google Sheets sync failed: ${syncRes.message}`, 'error');
        return { success: false, message: syncRes.message };
      } catch (err: any) {
        const errMsg = err?.message || 'Backend sync failed.';
        setBackendStatus('error');
        setBackendError(errMsg);
        showToast(`⚠️ Backend sync failed: ${errMsg}`, 'error');
        return { success: false, message: errMsg };
      }
    }

    // Demo Mode local update
    storageService.updateTicket(withUpdatedTimestamp);
    const updatedTickets = storageService.getTickets();
    setTickets(updatedTickets);
    setSelectedTicket(withUpdatedTimestamp);
    const demoMsg = `Ticket ${withUpdatedTimestamp.id} updated to ${withUpdatedTimestamp.status} (local demo storage).`;
    showToast(demoMsg, 'info');
    return { success: true, message: demoMsg };
  };

  const handleResetDemoData = () => {
    storageService.clearBackendUrl();
    storageService.clearLiveCache();
    setBackendUrl('');
    setBackendStatus('demo');
    setBackendError(null);
    setIsLoadingTickets(false);
    setLiveNotificationLogs([]);
    setMailStatus({ authorized: null });
    setRawDepartments([]);
    setDeptEmailSummary(null);
    setDepartmentsMap(DEPARTMENTS);
    const fresh = storageService.resetToDemoDefaults();
    setTickets(fresh.tickets);
    setRooms(fresh.rooms);
    setNotifications(fresh.notifs);
    showToast('Switched to Demo Mode with sample hackathon tickets (Projector, Markers, Broken Chair).', 'info');
  };

  const handleEvidenceRecorded = (updatedTicket: CampusTicket) => {
    setTickets((prev) => {
      const next = prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t));
      if (backendUrl) {
        storageService.saveLiveCachedTickets(next);
      } else {
        storageService.saveTickets(next);
      }
      return next;
    });
    setSelectedTicket(updatedTicket);
  };

  const handleRetryLiveNotification = async (ticketId: string) => {
    const activeUrl = storageService.getBackendUrl();
    if (!activeUrl) {
      return { success: false, message: 'No Apps Script backend URL configured.' };
    }
    const res = await storageService.retryNotificationOnBackend(ticketId, activeUrl, 'Dispatch Coordinator');
    const logsRes = await storageService.fetchBackendLogs(activeUrl, 'NotificationLogs').catch(() => null);
    if (logsRes && logsRes.success && Array.isArray(logsRes.notificationLogs)) {
      setLiveNotificationLogs(logsRes.notificationLogs);
    }
    if (res.success) {
      showToast(`✓ Email dispatch succeeded for ${ticketId}: ${res.message}`, 'success');
    } else {
      showToast(`Email dispatch ${res.notification?.status || 'failed'} for ${ticketId}: ${res.message}`, 'error');
    }
    return { success: res.success, message: res.message };
  };

  const handleSelectTicketById = (ticketId: string) => {
    const t = tickets.find((item) => item.id === ticketId);
    if (t) {
      setSelectedTicket(t);
    }
  };

  const handleReportIssueForRoom = (roomNumber: string, building: string) => {
    setReportInitialLocation({ room: roomNumber, building });
    setIsReportModalOpen(true);
  };

  const handleRefreshLiveTickets = async () => {
    const url = storageService.getBackendUrl();
    if (!url) {
      handleResetDemoData();
      return;
    }
    showToast('Syncing live tickets from Google Sheets...', 'info');
    await loadLiveBackendData(url, true);
  };

  const handleMarkNotificationRead = (id: string) => {
    setNotifications(storageService.markNotificationRead(id));
  };

  const handleMarkAllNotificationsRead = () => {
    setNotifications(storageService.markAllNotificationsRead());
  };

  const unreadNotificationCount = backendUrl
    ? liveNotificationLogs.filter((row) => {
        const st = String(row.Status || row.status || row.Result || row.result || '').toUpperCase();
        return st === 'FAILED' || st === 'SKIPPED';
      }).length
    : notifications.filter((n) => !n.isRead).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab as any)}
        onOpenReportModal={() => {
          setReportInitialLocation({});
          setIsReportModalOpen(true);
        }}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
        onResetData={handleResetDemoData}
        notificationCount={unreadNotificationCount}
        hasBackendUrl={!!backendUrl}
        backendStatus={backendStatus}
        onRefreshLiveTickets={handleRefreshLiveTickets}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex max-w-[1600px] w-full mx-auto">
        {/* Sidebar */}
        <div className="hidden md:block">
          <Sidebar
            currentTab={currentTab}
            onSelectTab={(tab) => setCurrentTab(tab as any)}
            tickets={tickets}
            onOpenReportModal={() => {
              setReportInitialLocation({});
              setIsReportModalOpen(true);
            }}
            onOpenNotifications={() => setIsNotificationsOpen(true)}
            onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
            onResetData={handleResetDemoData}
            notificationCount={unreadNotificationCount}
            backendStatus={backendStatus}
          />
        </div>

        {/* Content Viewport */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          {/* Differentiated Toast Alert */}
          {toast && (
            <div
              className={`mb-4 p-3.5 text-xs font-semibold rounded-lg shadow-md flex items-center justify-between transition-all border ${
                toast.type === 'success'
                  ? 'bg-emerald-600 text-white border-emerald-700'
                  : toast.type === 'error'
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-blue-600 text-white border-blue-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{toast.message}</span>
              </div>
              <button
                onClick={() => setToast(null)}
                className="text-white/80 hover:text-white ml-3 font-bold px-1"
              >
                ✕
              </button>
            </div>
          )}

          {/* Views */}
          {(currentTab === 'dashboard' || currentTab === 'tickets') && (
            <DashboardView
              tickets={tickets}
              onSelectTicket={(t) => setSelectedTicket(t)}
              onOpenReportModal={() => {
                setReportInitialLocation({});
                setIsReportModalOpen(true);
              }}
              onSelectRoom={(roomNum) => {
                setFocusedRoomNumber(roomNum);
                setCurrentTab('room-history');
              }}
              isLoading={isLoadingTickets}
              backendStatus={backendStatus}
              backendError={backendError}
              onRetrySync={handleRefreshLiveTickets}
              onSwitchToDemo={handleResetDemoData}
              onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
            />
          )}

          {currentTab === 'room-history' && (
            <RoomHistoryView
              rooms={rooms}
              tickets={tickets}
              onSelectTicket={(t) => setSelectedTicket(t)}
              onReportIssueForRoom={handleReportIssueForRoom}
              isBackendLive={!!backendUrl}
              initialSelectedRoom={focusedRoomNumber}
            />
          )}

          {currentTab === 'analytics' && (
            <AnalyticsView
              tickets={tickets}
              rooms={rooms}
              isBackendLive={!!backendUrl}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <ReportIssueModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmitTicket={handleCreateTicket}
        existingTickets={tickets}
        onSelectExistingTicket={handleSelectTicketById}
        initialBuilding={reportInitialLocation.building}
        initialRoom={reportInitialLocation.room}
        departmentsMap={departmentsMap}
      />

      <TicketDetailModal
        isOpen={!!selectedTicket}
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onUpdateTicket={handleUpdateTicket}
        onEvidenceRecorded={handleEvidenceRecorded}
        isBackendLive={backendStatus === 'live'}
        departmentsMap={departmentsMap}
      />

      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={notifications}
        liveLogsProp={liveNotificationLogs}
        mailAuthorized={mailStatus.authorized}
        mailDiagnostic={mailStatus.diagnostic}
        onLiveLogsUpdated={setLiveNotificationLogs}
        onRetryNotification={handleRetryLiveNotification}
        onSelectTicket={handleSelectTicketById}
        onMarkNotificationRead={handleMarkNotificationRead}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
      />

      <GoogleSheetsIntegrationModal
        isOpen={isSheetsModalOpen}
        onClose={() => setIsSheetsModalOpen(false)}
        tickets={tickets}
        liveLogs={liveNotificationLogs}
        rawDepartments={rawDepartments}
        deptEmailSummary={deptEmailSummary}
        mailStatus={mailStatus}
        onDepartmentsUpdated={applyDepartmentsSnapshot}
        onMailStatusUpdated={(nextMail) => setMailStatus(nextMail)}
        onConnectionStatusChange={(status) => setBackendStatus(status)}
        onBackendUrlUpdated={(url) => {
          setBackendUrl(url);
          if (!url) {
            setBackendStatus('demo');
            setBackendError(null);
            setIsLoadingTickets(false);
            setTickets(storageService.getTickets());
            setRooms(storageService.getRooms());
            setNotifications(storageService.getNotifications());
            setLiveNotificationLogs([]);
            setMailStatus({ authorized: null });
            setRawDepartments([]);
            setDeptEmailSummary(null);
            setDepartmentsMap(DEPARTMENTS);
            showToast('Backend URL cleared. Operating in local demo mode.', 'info');
          } else {
            setNotifications([]);
            loadLiveBackendData(url, true);
          }
        }}
      />
    </div>
  );
}
