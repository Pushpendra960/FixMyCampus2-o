import { CampusTicket, RoomRecord, SimulatedNotification } from '../types/campus';
import { INITIAL_NOTIFICATIONS, INITIAL_ROOMS, INITIAL_TICKETS } from '../data/mockData';

const STORAGE_KEYS = {
  TICKETS: 'fixmycampus_tickets_v2',
  ROOMS: 'fixmycampus_rooms_v2',
  NOTIFICATIONS: 'fixmycampus_notifications_v2',
  IS_INITIALIZED: 'fixmycampus_initialized_v2',
};

export const storageService = {
  getTickets(): CampusTicket[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TICKETS);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // fallback
    }
    this.saveTickets(INITIAL_TICKETS);
    return INITIAL_TICKETS;
  },

  saveTickets(tickets: CampusTicket[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  },

  getRooms(): RoomRecord[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // fallback
    }
    this.saveRooms(INITIAL_ROOMS);
    return INITIAL_ROOMS;
  },

  saveRooms(rooms: RoomRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  },

  getNotifications(): SimulatedNotification[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // fallback
    }
    this.saveNotifications(INITIAL_NOTIFICATIONS);
    return INITIAL_NOTIFICATIONS;
  },

  saveNotifications(notifs: SimulatedNotification[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  },

  addTicket(ticket: CampusTicket): void {
    const tickets = this.getTickets();
    const updated = [ticket, ...tickets];
    this.saveTickets(updated);

    // Update room incident count
    const rooms = this.getRooms();
    const roomIndex = rooms.findIndex(
      (r) => r.roomNumber.toLowerCase() === ticket.roomNumber.toLowerCase()
    );
    if (roomIndex >= 0) {
      rooms[roomIndex].totalIncidents += 1;
      if (!rooms[roomIndex].activeTickets.includes(ticket.id)) {
        rooms[roomIndex].activeTickets.push(ticket.id);
      }
      this.saveRooms(rooms);
    }
  },

  updateTicket(ticket: CampusTicket): void {
    const tickets = this.getTickets();
    const index = tickets.findIndex((t) => t.id === ticket.id);
    if (index >= 0) {
      tickets[index] = ticket;
      this.saveTickets(tickets);
    }
  },

  resetToDemoDefaults(): { tickets: CampusTicket[]; rooms: RoomRecord[]; notifs: SimulatedNotification[] } {
    localStorage.removeItem(STORAGE_KEYS.TICKETS);
    localStorage.removeItem(STORAGE_KEYS.ROOMS);
    localStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS);
    this.saveTickets(INITIAL_TICKETS);
    this.saveRooms(INITIAL_ROOMS);
    this.saveNotifications(INITIAL_NOTIFICATIONS);
    return {
      tickets: INITIAL_TICKETS,
      rooms: INITIAL_ROOMS,
      notifs: INITIAL_NOTIFICATIONS,
    };
  },

  /**
   * Generates next ticket ID like FMC-1007
   */
  generateNextTicketId(tickets: CampusTicket[]): string {
    const ids = tickets
      .map((t) => {
        const match = t.id.match(/FMC-(\d+)/);
        return match ? parseInt(match[1], 10) : 1000;
      })
      .filter((n) => !isNaN(n));

    const max = ids.length > 0 ? Math.max(...ids) : 1000;
    return `FMC-${max + 1}`;
  },

  /**
   * Google Apps Script Backend URL management
   */
  getBackendUrl(): string {
    try {
      return localStorage.getItem('fixmycampus_gas_url_v2') || '';
    } catch {
      return '';
    }
  },

  setBackendUrl(url: string): void {
    try {
      localStorage.setItem('fixmycampus_gas_url_v2', url.trim());
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  },

  async testBackendConnection(url: string): Promise<{ success: boolean; message: string; details?: any }> {
    const targetUrl = url.trim();
    if (!targetUrl) {
      return { success: false, message: 'No Google Apps Script Web App URL provided.' };
    }

    try {
      // First try via server proxy (which calls GET ?action=health)
      const res = await fetch('/api/sheets/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message || 'FixMyCampus Backend V2 is running.', details: data.details };
      } else {
        return { success: false, message: data.message || 'Backend connection test failed.', details: data.details };
      }
    } catch (proxyErr: any) {
      // Fallback: try direct fetch with ?action=health
      try {
        const directUrl = targetUrl.includes('?') ? `${targetUrl}&action=health` : `${targetUrl}?action=health`;
        const directRes = await fetch(directUrl, {
          method: 'GET',
          redirect: 'follow',
        });
        const data = await directRes.json();
        if (directRes.ok && data && data.success) {
          return { success: true, message: data.message || 'Connected directly to Google Apps Script backend.', details: data };
        } else {
          return { success: false, message: data?.message || `Backend responded with HTTP ${directRes.status}`, details: data };
        }
      } catch (directErr: any) {
        return {
          success: false,
          message: `Unable to reach backend: ${proxyErr.message || directErr.message || 'Network error'}`,
        };
      }
    }
  },

  async sendTicketToBackend(
    ticket: CampusTicket,
    url?: string
  ): Promise<{
    success: boolean;
    message: string;
    ticketId?: string;
    department?: string;
    notification?: { sent: boolean; message: string; status?: string; recipient?: string; cc?: string };
    data?: any;
    error?: string;
  }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) {
      return {
        success: false,
        message: 'No backend URL configured. Ticket saved in local memory only.',
      };
    }

    try {
      const res = await fetch('/api/sheets/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, ticket }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        return {
          success: true,
          message: data.message || 'Ticket recorded in Google Sheets.',
          ticketId: data.ticketId,
          department: data.department || data.backendResponse?.department,
          notification: data.notification,
          data: data.backendResponse,
        };
      } else {
        return {
          success: false,
          message: data.message || 'Google Sheets backend rejected the submission.',
          error: data.message,
        };
      }
    } catch (err: any) {
      // Fallback to direct call with action: createTicket
      try {
        const payload = {
          action: 'createTicket',
          description: ticket.description,
          building: ticket.building,
          roomNumber: ticket.roomNumber,
          reporterName: ticket.isAnonymous ? 'Anonymous Faculty' : ticket.facultyName,
          facultyName: ticket.isAnonymous ? 'Anonymous Faculty' : ticket.facultyName,
          isAnonymous: ticket.isAnonymous,
          priority: ticket.priority,
          category: ticket.category,
          department: ticket.recommendedDepartment,
          aiSummary: ticket.aiSummary || ticket.description,
          evidenceReference: ticket.photoUrl || '',
          facultyEmail: ticket.facultyEmail || '',
        };

        const directRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
        });

        const data = await directRes.json();
        if (directRes.ok && data && data.success) {
          return {
            success: true,
            message: 'Ticket recorded in Google Sheets (direct connection).',
            ticketId: data.ticketId,
            department: data.department,
            notification: data.notification,
          };
        } else {
          return {
            success: false,
            message: data?.message || `Backend returned HTTP ${directRes.status}`,
          };
        }
      } catch (directErr: any) {
        return {
          success: false,
          message: `Failed to transmit to Google Sheets backend: ${err.message || directErr.message}`,
          error: err.message || directErr.message,
        };
      }
    }
  },

  async updateTicketStatusOnBackend(
    ticketId: string,
    status: string,
    resolutionNotes?: string,
    evidenceReference?: string,
    url?: string
  ): Promise<{ success: boolean; message: string }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetch('/api/sheets/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: targetUrl,
          ticketId,
          status,
          resolutionNotes,
          evidenceReference,
        }),
      });
      const data = await res.json();
      return { success: data.success, message: data.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Status sync failed' };
    }
  },

  async fetchBackendTickets(url?: string): Promise<{ success: boolean; tickets?: CampusTicket[]; rawTickets?: any[]; message?: string }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetch('/api/sheets/fetch-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl }),
      });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.tickets)) {
        const mappedTickets: CampusTicket[] = data.tickets.map((row: any, idx: number) => {
          const id = String(row.TicketID || row.TicketId || row.ticketId || row['Ticket ID'] || row.id || `FMC-${1000 + idx}`);
          const isAnon = row.IsAnonymous === true || String(row.IsAnonymous).toLowerCase() === 'true';
          const reporter = isAnon ? 'Anonymous Faculty' : (row.ReporterName || row.reporterName || row.facultyName || 'Faculty');
          const building = row.Building || row.building || 'Campus';
          const roomNumber = row.RoomNumber || row.roomNumber || 'Room';
          const description = row.Description || row.description || '';
          const category = (row.Category || row.category || 'IT / Audio-Visual Support') as any;
          const priority = (row.Priority || row.priority || 'Medium') as any;
          const dept = row.Department || row.department || row.recommendedDepartment || category;
          const status = (row.Status || row.status || 'Open') as any;
          const aiSummary = row.AISummary || row.aiSummary || (description.length > 70 ? description.slice(0, 70) + '...' : description);
          const reportedAt = row.CreatedAt || row.createdAt || row.reportedAt || new Date().toISOString();
          const photoUrl = row.EvidenceReference || row.photoUrl || undefined;
          const resNotes = row.ResolutionNotes || row.resolutionNotes;
          const resAt = row.ResolvedAt || row.resolvedAt;

          return {
            id,
            facultyName: reporter,
            isAnonymous: isAnon,
            building,
            roomNumber,
            description,
            category,
            recommendedDepartment: dept,
            priority,
            status,
            aiSummary,
            urgencyReason: 'Authoritative record synchronized from Google Sheets Tickets sheet.',
            photoUrl,
            reportedAt,
            assignedDepartmentCoordinator: 'Campus Coordinator',
            assignedDepartmentHead: 'Department Head',
            timeline: [
              {
                id: `evt-${id}`,
                timestamp: reportedAt,
                action: 'Recorded in Google Sheets',
                actor: reporter,
                notes: `Routed to ${dept}`,
              },
            ],
            resolution: (resAt || resNotes) ? {
              resolvedAt: resAt || reportedAt,
              resolvedBy: 'Technician',
              notes: resNotes || 'Resolved per procedure',
              photoUrl,
            } : undefined,
            upvotes: 1,
          };
        });

        return {
          success: true,
          tickets: mappedTickets,
          rawTickets: data.tickets,
          message: data.message,
        };
      }
      return { success: false, message: data.message || 'No tickets found in sheet.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to fetch tickets' };
    }
  },

  async fetchBackendLogs(
    url?: string,
    logType?: string
  ): Promise<{
    success: boolean;
    notificationLogs?: any[];
    auditLogs?: any[];
    evidence?: any[];
    message?: string;
  }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetch('/api/sheets/fetch-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, logType }),
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to fetch logs' };
    }
  },

  async addEvidenceToBackend(
    evidence: {
      ticketId: string;
      evidenceType?: string;
      evidenceReference?: string;
      notes?: string;
      submittedBy?: string;
    },
    url?: string
  ): Promise<{ success: boolean; message: string; evidenceId?: string }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetch('/api/sheets/add-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, evidence }),
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to record evidence' };
    }
  },

  async fetchDepartments(url?: string): Promise<{ success: boolean; departments?: any[]; message?: string }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetch('/api/sheets/fetch-departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl }),
      });
      const data = await res.json();
      return { success: data.success, departments: data.departments, message: data.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to fetch departments' };
    }
  },

  async syncAllToBackend(
    tickets: CampusTicket[],
    url?: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) {
      return { success: false, message: 'Please configure your Google Apps Script Web App URL first.' };
    }

    try {
      const res = await fetch('/api/sheets/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, tickets }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message, details: data.backendResponse };
      } else {
        return { success: false, message: data.message || 'Sync failed.' };
      }
    } catch (err: any) {
      return { success: false, message: `Sync failed: ${err.message || 'Network error'}` };
    }
  },

  /**
   * Export to Google Sheets compatible CSV or JSON
   */
  exportToSheetsPayload(tickets: CampusTicket[]) {
    return tickets.map((t) => ({
      ticket_id: t.id,
      timestamp: t.reportedAt,
      reporter: t.isAnonymous ? 'Anonymous Faculty' : t.facultyName,
      building: t.building,
      room: t.roomNumber,
      category: t.category,
      priority: t.priority,
      status: t.status,
      assigned_to: t.assignedTo || 'Unassigned',
      coordinator: t.assignedDepartmentCoordinator || 'Pending',
      summary: t.aiSummary,
      resolved_at: t.resolution?.resolvedAt || 'N/A',
      resolved_by: t.resolution?.resolvedBy || 'N/A',
    }));
  },
};
