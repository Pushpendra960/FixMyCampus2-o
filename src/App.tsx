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
import { CampusTicket, RoomRecord, SimulatedNotification } from './types/campus';
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
  const [selectedTicket, setSelectedTicket] = useState<CampusTicket | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);

  // Success / notification toast with type
  const [toast, setToast] = useState<{
    message: string;
    type: 'info' | 'success' | 'error';
  } | null>(null);

  const [backendUrl, setBackendUrl] = useState<string>(storageService.getBackendUrl());

  // Load data on mount & attempt live sync with Google Sheets if configured
  useEffect(() => {
    const loadedTickets = storageService.getTickets();
    const loadedRooms = storageService.getRooms();
    const loadedNotifs = storageService.getNotifications();

    setTickets(loadedTickets);
    setRooms(loadedRooms);
    setNotifications(loadedNotifs);

    const backendUrl = storageService.getBackendUrl();
    if (backendUrl) {
      storageService.fetchBackendTickets(backendUrl).then((res) => {
        if (res.success && res.tickets && res.tickets.length > 0) {
          setTickets(res.tickets);
          storageService.saveTickets(res.tickets);
        }
      }).catch((err) => {
        console.warn('Initial live sheet sync notice:', err);
      });
    }
  }, []);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 6000);
  };

  const handleCreateTicket = async (newTicketData: CampusTicket) => {
    // Generate valid FMC ID
    const newId = storageService.generateNextTicketId(tickets);
    const finalizedTicket: CampusTicket = {
      ...newTicketData,
      id: newId,
    };

    // Add to local storage
    storageService.addTicket(finalizedTicket);
    const updatedTickets = storageService.getTickets();
    const updatedRooms = storageService.getRooms();
    setTickets(updatedTickets);
    setRooms(updatedRooms);

    // Queue simulated notifications for Coordinator & Department Head
    const deptInfo =
      DEPARTMENTS[finalizedTicket.recommendedDepartment] ||
      DEPARTMENTS['IT / Audio-Visual Support'];

    const newNotifs: SimulatedNotification[] = [
      {
        id: `notif-${Date.now()}`,
        ticketId: newId,
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
        ticketId: newId,
        recipientName: deptInfo.headName,
        recipientEmail: deptInfo.headEmail,
        recipientRole: 'Department Head',
        channel: 'Email (Simulated)',
        subject: `[Department Digest] ${finalizedTicket.category} Logged for ${finalizedTicket.roomNumber}`,
        body: `Automated executive notification: Ticket ${newId} logged for ${finalizedTicket.roomNumber}. Assigned coordinator: ${deptInfo.leadCoordinator}.`,
        timestamp: finalizedTicket.reportedAt,
        status: 'Dispatched (Demo)',
      },
    ];

    const currentNotifs = storageService.getNotifications();
    const combinedNotifs = [...newNotifs, ...currentNotifs];
    storageService.saveNotifications(combinedNotifs);
    setNotifications(combinedNotifs);

    // Check for configured Google Apps Script Web App backend
    const backendUrl = storageService.getBackendUrl();
    if (backendUrl) {
      showToast(`Transmitting ticket to Google Sheets backend...`, 'info');
      try {
        const backendRes = await storageService.sendTicketToBackend(finalizedTicket, backendUrl);
        if (backendRes.success) {
          // If backend generated authoritative ID e.g. FMC-6633D061, update local ticket
          if (backendRes.ticketId && backendRes.ticketId !== finalizedTicket.id) {
            finalizedTicket.id = backendRes.ticketId;
          }
          if (backendRes.department) {
            finalizedTicket.recommendedDepartment = backendRes.department;
            finalizedTicket.category = backendRes.department as any;
          }
          storageService.updateTicket(finalizedTicket);
          setTickets(storageService.getTickets());

          let notifMsg = '';
          if (backendRes.notification) {
            const n: any = backendRes.notification;
            if (n.status === 'SENT' || n.sent) {
              notifMsg = ` | MailApp: Outbound dispatch completed to ${n.recipient || 'responsible coordinator'}${n.cc ? ` (CC: ${n.cc})` : ''}`;
            } else if (n.status === 'FAILED') {
              notifMsg = ` | MailApp dispatch failed: ${n.message}`;
            } else {
              notifMsg = ` | MailApp dispatch skipped: ${n.message}`;
            }
          }

          showToast(
            `✓ Ticket ${finalizedTicket.id} stored in Google Sheets Tickets! [Routed to: ${finalizedTicket.recommendedDepartment}]${notifMsg}`,
            'success'
          );
        } else {
          showToast(
            `⚠️ Ticket ${newId} saved locally, but Google Sheets backend failed: ${backendRes.message}`,
            'error'
          );
        }
      } catch (err: any) {
        showToast(
          `⚠️ Ticket ${newId} saved locally, but network transmission failed: ${err.message}`,
          'error'
        );
      }
    } else {
      showToast(
        `Ticket ${newId} logged in demo storage. Configure your Web App URL in Sheets Sync to save to live Google Sheets.`,
        'info'
      );
    }
  };

  const handleUpdateTicket = async (updated: CampusTicket) => {
    storageService.updateTicket(updated);
    const updatedTickets = storageService.getTickets();
    setTickets(updatedTickets);
    setSelectedTicket(updated);
    showToast(`Ticket ${updated.id} status updated to ${updated.status}.`, 'info');

    // Also sync status update to backend if connected
    const backendUrl = storageService.getBackendUrl();
    if (backendUrl) {
      try {
        const syncRes = await storageService.updateTicketStatusOnBackend(
          updated.id,
          updated.status,
          updated.resolution?.notes,
          updated.resolution?.photoUrl,
          backendUrl
        );
        if (syncRes.success) {
          showToast(`✓ Ticket ${updated.id} status synced to Google Sheets.`, 'success');
        }
      } catch (err) {
        console.warn('Backend status update sync error:', err);
      }
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

  const handleReportIssueForRoom = (_roomNumber: string, _building: string) => {
    setIsReportModalOpen(true);
  };
  const handleRefreshLiveTickets = async () => {
    const url = storageService.getBackendUrl();
    if (!url) {
      handleResetDemoData();
      return;
    }
    showToast('Syncing live tickets from Google Sheets...', 'info');
    try {
      const res = await storageService.fetchBackendTickets(url);
      if (res.success && res.tickets && res.tickets.length > 0) {
        setTickets(res.tickets);
        storageService.saveTickets(res.tickets);
        showToast(`✓ Synchronized ${res.tickets.length} live tickets from Google Sheets!`, 'success');
      } else {
        showToast(`Google Sheets: ${res.message || 'No live tickets returned'}`, 'info');
      }
    } catch (err: any) {
      showToast(`Sheet query failed: ${err.message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab as any)}
        onOpenReportModal={() => setIsReportModalOpen(true)}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
        onResetData={handleResetDemoData}
        notificationCount={notifications.length}
        hasBackendUrl={!!backendUrl}
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
            onOpenReportModal={() => setIsReportModalOpen(true)}
            onOpenNotifications={() => setIsNotificationsOpen(true)}
            onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
            onResetData={handleResetDemoData}
            notificationCount={notifications.length}
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
              onOpenReportModal={() => setIsReportModalOpen(true)}
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
      />

      <TicketDetailModal
        isOpen={!!selectedTicket}
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onUpdateTicket={handleUpdateTicket}
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
        onBackendUrlUpdated={(url) => {
          setBackendUrl(url);
          showToast(
            url
              ? 'Google Apps Script backend URL saved. New tickets will sync directly to Google Sheets.'
              : 'Backend URL cleared. Operating in demo mode.',
            'info'
          );
        }}
      />
    </div>
  );
}
