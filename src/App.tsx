import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { RoomHistoryView } from './components/RoomHistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { ReportIssueModal } from './components/ReportIssueModal';
import { TicketDetailModal } from './components/TicketDetailModal';
import { NotificationsModal } from './components/NotificationsModal';
import { GoogleSheetsIntegrationModal } from './components/GoogleSheetsIntegrationModal';
import { BackendConnectionStatus, CampusTicket, RoomRecord, SimulatedNotification } from './types/campus';
import { storageService } from './services/storageService';
import { DEPARTMENTS } from './data/mockData';

export default function App() {
  const [tickets, setTickets] = useState<CampusTicket[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [notifications, setNotifications] = useState<SimulatedNotification[]>([]);

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'tickets' | 'room-history' | 'analytics'>('dashboard');

  // Modals
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportInitialLocation, setReportInitialLocation] = useState<{ building?: string; room?: string }>({});
  const [selectedTicket, setSelectedTicket] = useState<CampusTicket | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);

  // Success / notification toast with type
  const [toast, setToast] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  } | null>(null);

  const [backendUrl, setBackendUrl] = useState<string>(storageService.getBackendUrl());
  const [backendStatus, setBackendStatus] = useState<BackendConnectionStatus>(
    storageService.getBackendUrl() ? 'connecting' : 'demo'
  );

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 6000);
  };

  // Load data on mount & verify live Google Sheets connection if configured
  useEffect(() => {
    const loadedTickets = storageService.getTickets();
    const loadedRooms = storageService.getRooms();
    const loadedNotifs = storageService.getNotifications();

    setTickets(loadedTickets);
    setRooms(loadedRooms);
    setNotifications(loadedNotifs);

    const activeUrl = storageService.getBackendUrl();
    if (!activeUrl) {
      setBackendStatus('demo');
      return;
    }

    setBackendStatus('connecting');
    (async () => {
      const healthRes = await storageService.testBackendConnection(activeUrl);
      if (!healthRes.success) {
        setBackendStatus('error');
        showToast(
          `Google Sheets connection check failed: ${healthRes.message}. Open Sheets Sync to configure SPREADSHEET_ID.`,
          'error'
        );
        return;
      }

      const ticketRes = await storageService.fetchBackendTickets(activeUrl);
      if (ticketRes.success && Array.isArray(ticketRes.tickets)) {
        setBackendStatus('live');
        setTickets(ticketRes.tickets);
        storageService.saveTickets(ticketRes.tickets);
      } else {
        setBackendStatus('error');
        showToast(`Failed to read live tickets: ${ticketRes.message || 'Unknown error'}`, 'error');
      }
    })();
  }, []);

  const handleCreateTicket = async (newTicketData: CampusTicket) => {
    const tempId = storageService.generateNextTicketId(tickets);
    const finalizedTicket: CampusTicket = {
      ...newTicketData,
      id: tempId,
    };

    // Save locally immediately for responsive feedback
    storageService.addTicket(finalizedTicket);
    setTickets(storageService.getTickets());
    setRooms(storageService.getRooms());

    // Queue local notification queue entry (only used as demo record if no live backend)
    const deptInfo =
      DEPARTMENTS[finalizedTicket.recommendedDepartment] ||
      DEPARTMENTS['General Administration'] ||
      DEPARTMENTS['IT / Audio-Visual Support'];

    const newNotifs: SimulatedNotification[] = [
      {
        id: `notif-${Date.now()}`,
        ticketId: tempId,
        recipientName: deptInfo.leadCoordinator,
        recipientEmail: deptInfo.coordinatorEmail,
        recipientRole: 'Coordinator',
        channel: finalizedTicket.priority === 'Critical' ? 'SMS/Alert (Simulated)' : 'Email (Simulated)',
        subject: `[FixMyCampus] New ${finalizedTicket.priority} Priority Issue: ${finalizedTicket.roomNumber}`,
        body: `${finalizedTicket.isAnonymous ? 'Anonymous Faculty' : finalizedTicket.facultyName} reported: "${finalizedTicket.aiSummary}" in ${finalizedTicket.roomNumber} (${finalizedTicket.building}). Urgency: ${finalizedTicket.urgencyReason}`,
        timestamp: finalizedTicket.reportedAt,
        status: 'Dispatched (Demo)',
      },
      {
        id: `notif-${Date.now() + 1}`,
        ticketId: tempId,
        recipientName: deptInfo.headName,
        recipientEmail: deptInfo.headEmail,
        recipientRole: 'Department Head',
        channel: 'Email (Simulated)',
        subject: `[Department Digest] ${finalizedTicket.category} Logged for ${finalizedTicket.roomNumber}`,
        body: `Automated notification: Ticket ${tempId} logged for ${finalizedTicket.roomNumber}.`,
        timestamp: finalizedTicket.reportedAt,
        status: 'Dispatched (Demo)',
      },
    ];

    const currentNotifs = storageService.getNotifications();
    const combinedNotifs = [...newNotifs, ...currentNotifs];
    storageService.saveNotifications(combinedNotifs);
    setNotifications(combinedNotifs);

    const activeUrl = storageService.getBackendUrl();
    if (activeUrl) {
      showToast('Transmitting ticket to Google Sheets backend...', 'info');
      try {
        const backendRes = await storageService.sendTicketToBackend(finalizedTicket, activeUrl);
        if (backendRes.success) {
          setBackendStatus('live');
          const syncedTicket: CampusTicket = {
            ...finalizedTicket,
            id: backendRes.ticketId || tempId,
            recommendedDepartment: backendRes.department || finalizedTicket.recommendedDepartment,
            category: (backendRes.department || finalizedTicket.category) as any,
            status: (backendRes.requiresManualReview
              ? 'Needs Review'
              : backendRes.status || finalizedTicket.status) as any,
          };

          // Replace temporary ID cleanly in localStorage & state
          storageService.replaceTicket(tempId, syncedTicket);
          setTickets(storageService.getTickets());

          let notifMsg = '';
          if (backendRes.notification) {
            const n: any = backendRes.notification;
            if (n.status === 'SENT' || n.sent) {
              notifMsg = ` | MailApp: Outbound email sent to ${n.recipient || 'coordinator'}${n.cc ? ` (CC: ${n.cc})` : ''}`;
            } else if (n.status === 'FAILED') {
              notifMsg = ` | MailApp failed: ${n.message}`;
            } else {
              notifMsg = ` | MailApp skipped: ${n.message}`;
            }
          }

          showToast(
            `✓ Ticket ${syncedTicket.id} saved in Google Sheets [Dept: ${syncedTicket.recommendedDepartment}]${notifMsg}`,
            'success'
          );
        } else {
          setBackendStatus('error');
          showToast(
            `⚠️ Ticket ${tempId} saved locally only — Google Sheets backend rejected submission: ${backendRes.message}`,
            'error'
          );
        }
      } catch (err: any) {
        setBackendStatus('error');
        showToast(
          `⚠️ Ticket ${tempId} saved locally only — network transmission failed: ${err.message}`,
          'error'
        );
      }
    } else {
      showToast(
        `Ticket ${tempId} logged in local demo storage. Configure your Web App URL in Sheets Sync to persist to Google Sheets.`,
        'info'
      );
    }
  };

  const handleUpdateTicket = async (updated: CampusTicket) => {
    storageService.updateTicket(updated);
    const updatedTickets = storageService.getTickets();
    setTickets(updatedTickets);
    setSelectedTicket(updated);

    const activeUrl = storageService.getBackendUrl();
    if (activeUrl) {
      try {
        const syncRes = await storageService.updateTicketStatusOnBackend(
          updated.id,
          updated.status,
          updated.resolution?.notes,
          updated.resolution?.photoUrl,
          activeUrl,
          updated.resolution?.resolvedBy || 'Staff',
          updated.assignedTo
        );
        if (syncRes.success) {
          setBackendStatus('live');
          showToast(`✓ Ticket ${updated.id} (${updated.status}) synced to Google Sheets.`, 'success');
        } else {
          setBackendStatus('error');
          showToast(`⚠️ Updated locally, but Google Sheets sync failed: ${syncRes.message}`, 'error');
        }
      } catch (err: any) {
        setBackendStatus('error');
        showToast(`⚠️ Updated locally, but backend sync failed: ${err.message}`, 'error');
      }
    } else {
      showToast(`Ticket ${updated.id} updated to ${updated.status} (local demo storage).`, 'info');
    }
  };

  const handleResetDemoData = () => {
    const fresh = storageService.resetToDemoDefaults();
    setTickets(fresh.tickets);
    setRooms(fresh.rooms);
    setNotifications(fresh.notifs);
    showToast('Reset to initial hackathon sample data (Projector, Markers, Broken Chair).', 'info');
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
    setBackendStatus('connecting');
    showToast('Syncing live tickets from Google Sheets...', 'info');
    try {
      const health = await storageService.testBackendConnection(url);
      if (!health.success) {
        setBackendStatus('error');
        showToast(`Google Sheets health check failed: ${health.message}`, 'error');
        return;
      }

      const res = await storageService.fetchBackendTickets(url);
      if (res.success && Array.isArray(res.tickets)) {
        setBackendStatus('live');
        setTickets(res.tickets);
        storageService.saveTickets(res.tickets);
        showToast(`✓ Synchronized ${res.tickets.length} live ticket(s) from Google Sheets!`, 'success');
      } else {
        setBackendStatus('error');
        showToast(`Google Sheets error: ${res.message || 'Unable to fetch tickets'}`, 'error');
      }
    } catch (err: any) {
      setBackendStatus('error');
      showToast(`Sheet query failed: ${err.message}`, 'error');
    }
  };

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
        notificationCount={notifications.length}
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
            notificationCount={notifications.length}
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
              onSelectRoom={() => setCurrentTab('room-history')}
            />
          )}

          {currentTab === 'room-history' && (
            <RoomHistoryView
              rooms={rooms}
              tickets={tickets}
              onSelectTicket={(t) => setSelectedTicket(t)}
              onReportIssueForRoom={handleReportIssueForRoom}
            />
          )}

          {currentTab === 'analytics' && (
            <AnalyticsView tickets={tickets} rooms={rooms} />
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
      />

      <TicketDetailModal
        isOpen={!!selectedTicket}
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onUpdateTicket={handleUpdateTicket}
        isBackendLive={backendStatus === 'live'}
      />

      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={notifications}
        onSelectTicket={handleSelectTicketById}
      />

      <GoogleSheetsIntegrationModal
        isOpen={isSheetsModalOpen}
        onClose={() => setIsSheetsModalOpen(false)}
        tickets={tickets}
        onConnectionStatusChange={(status) => setBackendStatus(status)}
        onBackendUrlUpdated={(url) => {
          setBackendUrl(url);
          if (!url) {
            setBackendStatus('demo');
            showToast('Backend URL cleared. Operating in local demo mode.', 'info');
          }
        }}
      />
    </div>
  );
}
