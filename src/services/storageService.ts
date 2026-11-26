import {
  ALLOWED_IMAGE_MIME_TYPES,
  CampusTicket,
  DepartmentDirectoryRow,
  DepartmentDirectorySummary,
  MAX_IMAGE_FILE_BYTES,
  RoomRecord,
  SimulatedNotification,
  TicketEvidenceRecord,
  TicketPriority,
  TicketStatus,
  TicketTimelineEvent,
  VALID_TICKET_STATUSES,
} from '../types/campus';
import { INITIAL_NOTIFICATIONS, INITIAL_ROOMS, INITIAL_TICKETS } from '../data/mockData';

const STORAGE_KEYS = {
  TICKETS: 'fixmycampus_tickets_v2',
  LIVE_TICKETS_CACHE: 'fixmycampus_live_tickets_v2',
  ROOMS: 'fixmycampus_rooms_v2',
  NOTIFICATIONS: 'fixmycampus_notifications_v2',
  BACKEND_URL: 'fixmycampus_gas_url_v2',
  LAST_SYNC_META: 'fixmycampus_last_sync_v2',
};

const API_TIMEOUT_MS = 22000;
const MAX_SHEET_IMAGE_DATA_CHARS = 44000;

/**
 * Validates that an image or evidence URL is safe to render in <img src> or <a href>
 * (blocks javascript:, data:text/html, and SVG scripts).
 */
export function isSafeMediaUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeSheetPriority(raw: unknown): TicketPriority {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'high') return 'High';
  if (s === 'low') return 'Low';
  return 'Medium';
}

export function normalizeSheetStatus(raw: unknown): TicketStatus {
  const s = String(raw || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!s) return 'Open';
  const match = VALID_TICKET_STATUSES.find(
    (st) => st.toLowerCase().replace(/[\s_-]+/g, '') === s
  );
  return match || 'Open';
}

export function normalizeSheetDate(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return str;
  }
  return str;
}

function safeParseArray<T>(raw: string | null): T[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item === 'object');
    }
  } catch {
    // ignore corrupt localStorage entries
  }
  return null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function safeParseResponseJson(res: Response): Promise<{
  parsed: any | null;
  text: string;
  isHtml: boolean;
  contentType: string;
}> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  const trimmed = text.trim().toLowerCase();
  const looksLikeHtml =
    contentType.toLowerCase().includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<head>');

  try {
    return { parsed: JSON.parse(text), text, isHtml: false, contentType };
  } catch {
    return { parsed: null, text, isHtml: looksLikeHtml, contentType };
  }
}

export function interpretProxyError(
  res: Response,
  parsed: any | null,
  text: string,
  isHtml: boolean,
  contentType: string,
  fallbackLabel: string
): {
  message: string;
  errorType: string;
  diagnosticHint?: string;
  details?: any;
} {
  if (isHtml && !parsed) {
    return {
      errorType: 'SPA_FALLBACK_HTML',
      message: `API route returned an HTML page instead of JSON (HTTP ${res.status}, ${contentType || 'text/html'}).`,
      diagnosticHint:
        'The Express backend server (server.ts) is not handling /api/* routes at this origin — static hosting served index.html instead. Start the full-stack Node/Express server (`npm start` or `npm run dev`) so /api/* routes proxy to Google Apps Script.',
      details: text.slice(0, 300),
    };
  }

  if (parsed && typeof parsed === 'object') {
    return {
      errorType: parsed.errorType || (res.status >= 500 ? 'BACKEND_EXCEPTION' : 'REQUEST_REJECTED'),
      message: parsed.message || `${fallbackLabel} (HTTP ${res.status}).`,
      diagnosticHint: parsed.diagnosticHint,
      details: parsed.details ?? parsed,
    };
  }

  return {
    errorType: 'MALFORMED_JSON',
    message: `${fallbackLabel} (HTTP ${res.status}: unexpected non-JSON response).`,
    diagnosticHint: 'Verify that server.ts is running and reachable at /api/*.',
    details: text.slice(0, 300),
  };
}

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }
  const normalizedType = (file.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(normalizedType as any)) {
    return {
      valid: false,
      error: 'Unsupported image format. Please upload a JPEG, PNG, WebP, or GIF image.',
    };
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Image file (${mb} MB) exceeds the 10 MB upload limit.`,
    };
  }
  return { valid: true };
}

export const storageService = {
  getTickets(): CampusTicket[] {
    try {
      const parsed = safeParseArray<CampusTicket>(localStorage.getItem(STORAGE_KEYS.TICKETS));
      if (parsed) return parsed;
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

  getLiveCachedTickets(): CampusTicket[] {
    try {
      const parsed = safeParseArray<CampusTicket>(localStorage.getItem(STORAGE_KEYS.LIVE_TICKETS_CACHE));
      if (parsed) return parsed;
    } catch {
      // ignore
    }
    return [];
  },

  saveLiveCachedTickets(tickets: CampusTicket[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LIVE_TICKETS_CACHE, JSON.stringify(tickets));
      localStorage.setItem(
        STORAGE_KEYS.LAST_SYNC_META,
        JSON.stringify({
          lastSyncAt: new Date().toISOString(),
          count: tickets.length,
        })
      );
    } catch (e) {
      console.warn('LocalStorage live cache save failed:', e);
    }
  },

  clearLiveCache(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.LIVE_TICKETS_CACHE);
      localStorage.removeItem(STORAGE_KEYS.LAST_SYNC_META);
    } catch {
      // ignore
    }
  },

  getLastSyncMeta(): { lastSyncAt: string; count: number } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAST_SYNC_META);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  getRooms(): RoomRecord[] {
    try {
      const parsed = safeParseArray<RoomRecord>(localStorage.getItem(STORAGE_KEYS.ROOMS));
      if (parsed) return parsed;
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
      const parsed = safeParseArray<SimulatedNotification>(
        localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)
      );
      if (parsed) return parsed;
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

  markNotificationRead(id: string): SimulatedNotification[] {
    const current = this.getNotifications();
    const updated = current.map((n) => (n.id === id ? { ...n, isRead: true } : n));
    this.saveNotifications(updated);
    return updated;
  },

  markAllNotificationsRead(): SimulatedNotification[] {
    const current = this.getNotifications();
    const updated = current.map((n) => ({ ...n, isRead: true }));
    this.saveNotifications(updated);
    return updated;
  },

  addTicket(ticket: CampusTicket): void {
    const tickets = this.getTickets();
    const updated = [ticket, ...tickets.filter((t) => t.id !== ticket.id)];
    this.saveTickets(updated);

    // Update demo room incident count
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

  replaceTicket(oldId: string, ticket: CampusTicket): void {
    const tickets = this.getTickets();
    const index = tickets.findIndex((t) => t.id === oldId || t.id === ticket.id);
    if (index >= 0) {
      tickets[index] = ticket;
      this.saveTickets(tickets);
    } else {
      this.saveTickets([ticket, ...tickets]);
    }
  },

  async compressImageFile(file: File, maxDim = 640, maxChars = 35000): Promise<string> {
    const check = validateImageFile(file);
    if (!check.valid) {
      throw new Error(check.error || 'Invalid image file.');
    }

    const rawDataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });

    if (!rawDataUrl || rawDataUrl.length <= maxChars) {
      return rawDataUrl;
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode uploaded image for compression.'));
      image.src = rawDataUrl;
    });

    const dims = [maxDim, 480, 360];
    let bestCandidate = '';

    for (const dim of dims) {
      const scale = Math.min(1, dim / Math.max(img.width || 1, img.height || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to initialize canvas compressor for oversized image.');
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let quality = 0.72;
      while (quality >= 0.24) {
        const compressed = canvas.toDataURL('image/jpeg', quality);
        bestCandidate = compressed;
        if (compressed.length <= maxChars) {
          return compressed;
        }
        quality -= 0.15;
      }
    }

    if (bestCandidate && bestCandidate.length <= MAX_SHEET_IMAGE_DATA_CHARS) {
      return bestCandidate;
    }

    throw new Error(
      `Compressed image still exceeds Google Sheets cell limit (${MAX_SHEET_IMAGE_DATA_CHARS.toLocaleString()} chars). Please choose a smaller or lower-resolution photo.`
    );
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
        const match = String(t.id || '').match(/FMC-(\d+)/);
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
      return localStorage.getItem(STORAGE_KEYS.BACKEND_URL) || '';
    } catch {
      return '';
    }
  },

  setBackendUrl(url: string): void {
    try {
      const trimmed = url.trim();
      if (!trimmed) {
        localStorage.removeItem(STORAGE_KEYS.BACKEND_URL);
      } else {
        localStorage.setItem(STORAGE_KEYS.BACKEND_URL, trimmed);
      }
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  },

  clearBackendUrl(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.BACKEND_URL);
    } catch {
      // ignore
    }
  },

  async testBackendConnection(url: string): Promise<{
    success: boolean;
    message: string;
    errorType?: string;
    diagnosticHint?: string;
    httpStatus?: number;
    contentType?: string;
    details?: any;
  }> {
    const targetUrl = url.trim();
    if (!targetUrl) {
      return {
        success: false,
        errorType: 'INVALID_DEPLOYMENT_URL',
        message: 'No Google Apps Script Web App URL provided.',
        diagnosticHint: 'Paste your deployed https://script.google.com/macros/s/.../exec URL.',
      };
    }

    try {
      const res = await fetchWithTimeout('/api/sheets/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl }),
      });

      const { parsed, text, isHtml, contentType } = await safeParseResponseJson(res);
      if (res.ok && parsed && parsed.success) {
        if (parsed.details && parsed.details.spreadsheetConnected === false) {
          return {
            success: false,
            errorType: 'SPREADSHEET_NOT_CONNECTED',
            httpStatus: res.status,
            contentType,
            message:
              parsed.details.diagnostic ||
              'Apps Script reachable, but Google Sheet connection failed (spreadsheetConnected: false).',
            diagnosticHint:
              'Configure SPREADSHEET_ID in Code.gs, run setupFixMyCampus(), and deploy a New version.',
            details: parsed.details,
          };
        }
        return {
          success: true,
          errorType: 'OK',
          httpStatus: res.status,
          contentType,
          message: parsed.message || 'FixMyCampus Backend V2 is running.',
          details: parsed.details,
        };
      }

      const diag = interpretProxyError(
        res,
        parsed,
        text,
        isHtml,
        contentType,
        'Backend connection test failed'
      );
      return {
        success: false,
        errorType: diag.errorType,
        diagnosticHint: diag.diagnosticHint,
        httpStatus: parsed?.httpStatus || res.status,
        contentType: parsed?.contentType || contentType,
        message: diag.message,
        details: diag.details,
      };
    } catch (proxyErr: any) {
      const isTimeout = String(proxyErr?.message || '').toLowerCase().includes('timed out');
      return {
        success: false,
        errorType: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: `Unable to reach backend proxy: ${proxyErr.message || 'Network error'}`,
        diagnosticHint: isTimeout
          ? 'The connection request timed out. Retry Test Connection or verify server.ts is responsive.'
          : 'Confirm the FixMyCampus Express backend server is running on port 3000.',
      };
    }
  },

  async sendTicketToBackend(
    ticket: CampusTicket,
    url?: string
  ): Promise<{
    success: boolean;
    message: string;
    ticketId?: string;
    category?: string;
    priority?: string;
    department?: string;
    status?: string;
    requiresManualReview?: boolean;
    notification?: { sent: boolean; message: string; status?: string; recipient?: string; cc?: string };
    reporterNotification?: { sent: boolean; message: string; status?: string; recipient?: string } | null;
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
      const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetchWithTimeout('/api/sheets/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, ticket, appUrl }),
      });

      const { parsed, text, isHtml, contentType } = await safeParseResponseJson(res);
      if (res.ok && parsed && parsed.success) {
        return {
          success: true,
          message: parsed.message || 'Ticket recorded in Google Sheets.',
          ticketId: parsed.ticketId,
          category: parsed.category || parsed.backendResponse?.category,
          priority: parsed.priority || parsed.backendResponse?.priority,
          department: parsed.department || parsed.backendResponse?.department,
          status: parsed.status || parsed.backendResponse?.status,
          requiresManualReview: !!(parsed.requiresManualReview || parsed.backendResponse?.requiresManualReview),
          notification: parsed.notification,
          reporterNotification: parsed.reporterNotification || parsed.backendResponse?.reporterNotification || null,
          data: parsed.backendResponse,
        };
      }
      const diag = interpretProxyError(
        res,
        parsed,
        text,
        isHtml,
        contentType,
        'Google Sheets backend rejected the submission'
      );
      return {
        success: false,
        message: diag.diagnosticHint ? `${diag.message} ${diag.diagnosticHint}` : diag.message,
        error: diag.message,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to transmit to Google Sheets backend: ${err.message || 'Network error'}`,
        error: err.message,
      };
    }
  },

  async updateTicketStatusOnBackend(
    ticketId: string,
    status: string,
    resolutionNotes?: string,
    evidenceReference?: string,
    url?: string,
    updatedBy?: string,
    assignedTo?: string,
    previousStatus?: string,
    extra?: {
      reporterEmail?: string;
      assignedTechnicianEmail?: string;
      notifyReporter?: boolean;
      isVerified?: boolean;
    }
  ): Promise<{
    success: boolean;
    message: string;
    department?: string;
    assignedTo?: string;
    updatedAt?: string;
    notification?: any;
  }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetchWithTimeout('/api/sheets/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: targetUrl,
          ticketId,
          status,
          previousStatus,
          resolutionNotes,
          evidenceReference,
          updatedBy,
          assignedTo,
          reporterEmail: extra?.reporterEmail,
          assignedTechnicianEmail: extra?.assignedTechnicianEmail,
          notifyReporter: extra?.notifyReporter,
          isVerified: extra?.isVerified,
          appUrl,
        }),
      });
      const { parsed, text, isHtml, contentType } = await safeParseResponseJson(res);
      if (res.ok && parsed?.success) {
        return {
          success: true,
          message: parsed.message,
          department: parsed.department || parsed.backendResponse?.department,
          assignedTo: parsed.assignedTo ?? parsed.backendResponse?.assignedTo,
          updatedAt: parsed.updatedAt || parsed.backendResponse?.updatedAt,
          notification: parsed.notification || parsed.backendResponse?.notification,
        };
      }
      const diag = interpretProxyError(res, parsed, text, isHtml, contentType, 'Status sync failed');
      return {
        success: false,
        message: diag.message,
        department: parsed?.department || parsed?.backendResponse?.department,
        assignedTo: parsed?.assignedTo ?? parsed?.backendResponse?.assignedTo,
        updatedAt: parsed?.updatedAt || parsed?.backendResponse?.updatedAt,
        notification: parsed?.notification || parsed?.backendResponse?.notification,
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Status sync failed' };
    }
  },

  async retryNotificationOnBackend(
    ticketId: string,
    url?: string,
    actor = 'Dispatcher'
  ): Promise<{ success: boolean; message: string; notification?: any }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetchWithTimeout('/api/sheets/retry-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: targetUrl,
          ticketId,
          appUrl,
          actor,
        }),
      });
      const { parsed } = await safeParseResponseJson(res);
      return {
        success: !!(res.ok && parsed?.success),
        message: parsed?.message || `Notification retry returned HTTP ${res.status}.`,
        notification: parsed?.notification,
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Retry notification failed' };
    }
  },

  hydrateTicketsWithLogs(
    tickets: CampusTicket[],
    auditLogs: any[] = [],
    evidenceRows: any[] = []
  ): CampusTicket[] {
    if (!Array.isArray(tickets) || tickets.length === 0) return tickets;

    const auditByTicket = new Map<string, TicketTimelineEvent[]>();
    for (let i = 0; i < auditLogs.length; i++) {
      const row = auditLogs[i];
      if (!row || typeof row !== 'object') continue;
      const tid = String(row.TicketID || row.TicketId || row.ticketId || '').trim().toUpperCase();
      if (!tid) continue;
      const list = auditByTicket.get(tid) || [];
      list.push({
        id: `audit-${tid}-${i}`,
        timestamp: normalizeSheetDate(row.Timestamp || row.timestamp) || 'Recorded',
        action: String(row.Action || row.action || 'Sheet Update').trim(),
        actor: String(row.Actor || row.actor || 'System').trim(),
        notes: String(row.Details || row.details || '').trim() || undefined,
      });
      auditByTicket.set(tid, list);
    }

    const evidenceByTicket = new Map<string, TicketEvidenceRecord[]>();
    for (let i = 0; i < evidenceRows.length; i++) {
      const row = evidenceRows[i];
      if (!row || typeof row !== 'object') continue;
      const tid = String(row.TicketID || row.TicketId || row.ticketId || '').trim().toUpperCase();
      if (!tid) continue;
      const rawRef = String(row.EvidenceReference || row.evidenceReference || row.PhotoURL || '').trim();
      const safeRef = isSafeMediaUrl(rawRef) ? rawRef : '';
      const list = evidenceByTicket.get(tid) || [];
      list.push({
        evidenceId: String(row.EvidenceID || row.evidenceId || `EVD-${i + 1}`).trim(),
        ticketId: tid,
        evidenceType: String(row.EvidenceType || row.evidenceType || 'Evidence').trim(),
        evidenceReference: safeRef,
        notes: String(row.Notes || row.notes || row.Note || '').trim(),
        submittedAt: normalizeSheetDate(row.SubmittedAt || row.submittedAt || row.Timestamp) || 'Recorded',
        submittedBy: String(row.SubmittedBy || row.submittedBy || 'Staff').trim(),
      });
      evidenceByTicket.set(tid, list);
    }

    return tickets.map((t) => {
      const key = t.id.trim().toUpperCase();
      const sheetEvents = auditByTicket.get(key) || [];
      const sheetEvidence = evidenceByTicket.get(key) || [];

      const timeline =
        sheetEvents.length > 0
          ? [...sheetEvents].sort((a, b) => {
              const msA = Date.parse(a.timestamp) || 0;
              const msB = Date.parse(b.timestamp) || 0;
              return msA - msB;
            })
          : t.timeline;

      const latestEvidence = sheetEvidence[sheetEvidence.length - 1];
      const latestPhoto =
        [...sheetEvidence].reverse().find((e) => e.evidenceReference)?.evidenceReference ||
        t.resolution?.photoUrl;

      let resolution = t.resolution;
      if (latestEvidence) {
        resolution = {
          resolvedAt: t.resolution?.resolvedAt || latestEvidence.submittedAt,
          resolvedBy: t.resolution?.resolvedBy || latestEvidence.submittedBy || t.assignedTo || 'Technician',
          notes: t.resolution?.notes || latestEvidence.notes || 'Evidence recorded',
          photoUrl: latestPhoto,
          verifiedAt: t.resolution?.verifiedAt,
          verifiedBy: t.resolution?.verifiedBy,
        };
      }

      return {
        ...t,
        timeline,
        resolution,
        evidenceRecords: sheetEvidence.length > 0 ? sheetEvidence : t.evidenceRecords,
      };
    });
  },

  async fetchBackendTickets(
    url?: string
  ): Promise<{ success: boolean; tickets?: CampusTicket[]; rawTickets?: any[]; message?: string }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetchWithTimeout('/api/sheets/fetch-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl }),
      });
      const { parsed, text, isHtml, contentType } = await safeParseResponseJson(res);
      if (res.ok && parsed && parsed.success && Array.isArray(parsed.tickets)) {
        const mappedTickets: CampusTicket[] = parsed.tickets.map((row: any, idx: number) => {
          const id = String(
            row.TicketID || row.TicketId || row.ticketId || row['Ticket ID'] || row.id || `FMC-${1000 + idx}`
          ).trim();
          const isAnon = row.IsAnonymous === true || String(row.IsAnonymous).toLowerCase().trim() === 'true';
          const reporter = isAnon
            ? 'Anonymous Faculty'
            : String(row.ReporterName || row.reporterName || row.facultyName || 'Faculty').trim();
          const building = String(row.Building || row.building || 'Campus').trim();
          const roomNumber = String(row.RoomNumber || row.roomNumber || 'Room').trim();
          const description = String(row.Description || row.description || '').trim();
          const dept = String(
            row.Department || row.department || row.recommendedDepartment || 'General Administration'
          ).trim();
          const category = (String(row.Category || row.category || '').trim() || dept || 'General Administration') as any;
          const priority = normalizeSheetPriority(row.Priority || row.priority);
          const status = normalizeSheetStatus(row.Status || row.status);
          const aiSummary = String(
            row.AISummary ||
              row.aiSummary ||
              (description.length > 70 ? description.slice(0, 70) + '...' : description)
          ).trim();
          const reportedAt = normalizeSheetDate(row.CreatedAt || row.createdAt || row.reportedAt);
          const closedAt = normalizeSheetDate(row.ClosedAt || row.closedAt) || undefined;
          const updatedAt =
            normalizeSheetDate(row.UpdatedAt || row.updatedAt || row.ResolvedAt || row.ClosedAt || row.AssignedAt) ||
            reportedAt;
          const rawPhoto = row.EvidenceReference || row.photoUrl || undefined;
          const cleanPhotoUrl =
            rawPhoto && !String(rawPhoto).startsWith('[') && isSafeMediaUrl(String(rawPhoto))
              ? String(rawPhoto).trim()
              : undefined;
          const resNotes = row.ResolutionNotes || row.resolutionNotes;
          const resAt = normalizeSheetDate(row.ResolvedAt || row.resolvedAt);
          const assignedTo = row.AssignedTo || row.assignedTo || undefined;

          return {
            id,
            facultyName: reporter,
            isAnonymous: isAnon,
            facultyEmail: isAnon ? undefined : row.ReporterEmail || row.facultyEmail || undefined,
            building,
            roomNumber,
            description,
            category,
            recommendedDepartment: dept,
            priority,
            status,
            aiSummary,
            urgencyReason:
              row.UrgencyReason || 'Synchronized from authoritative Google Sheets Tickets record.',
            suggestedAction: row.SuggestedAction || undefined,
            photoUrl: cleanPhotoUrl,
            reportedAt,
            updatedAt,
            closedAt,
            assignedTo,
            assignedDepartmentCoordinator: row.AssignedCoordinator || row.Coordinator || undefined,
            assignedDepartmentHead: row.DepartmentHead || undefined,
            timeline: [
              {
                id: `evt-${id}`,
                timestamp: reportedAt || 'Recorded in Sheet',
                action: 'Recorded in Google Sheets',
                actor: reporter,
                notes: `Routed to ${dept}`,
              },
            ],
            resolution:
              resAt || resNotes || closedAt
                ? {
                    resolvedAt: resAt || closedAt || updatedAt,
                    resolvedBy: row.ResolvedBy || assignedTo || 'Technician',
                    notes: resNotes || 'Resolved per procedure',
                    photoUrl: cleanPhotoUrl,
                  }
                : undefined,
            isDuplicateOf: row.DuplicateOf || undefined,
            upvotes: Number(row.Upvotes) > 0 ? Number(row.Upvotes) : 1,
          };
        });

        this.saveLiveCachedTickets(mappedTickets);

        return {
          success: true,
          tickets: mappedTickets,
          rawTickets: parsed.tickets,
          message: parsed.message,
        };
      }
      const diag = interpretProxyError(res, parsed, text, isHtml, contentType, 'Failed to fetch tickets from sheet');
      return {
        success: false,
        message: diag.message,
      };
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
      const res = await fetchWithTimeout('/api/sheets/fetch-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, logType }),
      });
      const { parsed, text, isHtml, contentType } = await safeParseResponseJson(res);
      if (!parsed) {
        const diag = interpretProxyError(res, parsed, text, isHtml, contentType, 'Invalid response from logs endpoint');
        return { success: false, message: diag.message };
      }
      return parsed;
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
      const res = await fetchWithTimeout('/api/sheets/add-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, evidence }),
      });
      const { parsed } = await safeParseResponseJson(res);
      return {
        success: !!(res.ok && parsed?.success),
        message: parsed?.message || `Evidence submission returned HTTP ${res.status}.`,
        evidenceId: parsed?.evidenceId,
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to record evidence' };
    }
  },

  async fetchDepartments(url?: string): Promise<{
    success: boolean;
    departments?: DepartmentDirectoryRow[];
    summary?: DepartmentDirectorySummary | null;
    message?: string;
  }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) return { success: false, message: 'No backend URL configured.' };

    try {
      const res = await fetchWithTimeout('/api/sheets/fetch-departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl }),
      });
      const { parsed } = await safeParseResponseJson(res);
      return {
        success: !!(res.ok && parsed?.success),
        departments: parsed?.departments,
        summary: parsed?.summary || null,
        message: parsed?.message || (res.ok ? undefined : `HTTP ${res.status}`),
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to fetch departments' };
    }
  },

  async sendTestEmail(
    recipientEmail: string,
    url?: string,
    actor = 'System Admin'
  ): Promise<{
    success: boolean;
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    recipient?: string;
    remainingQuota?: number | null;
    timestamp?: string;
    message: string;
  }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) {
      return { success: false, status: 'SKIPPED', message: 'No Google Apps Script Web App URL configured.' };
    }
    try {
      const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetchWithTimeout('/api/sheets/send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: targetUrl,
          recipientEmail: recipientEmail.trim(),
          appUrl,
          actor,
        }),
      });
      const { parsed } = await safeParseResponseJson(res);
      return {
        success: !!(res.ok && parsed?.success),
        status: parsed?.status || (res.ok && parsed?.success ? 'SENT' : 'FAILED'),
        recipient: parsed?.recipient || recipientEmail.trim(),
        remainingQuota: parsed?.remainingQuota ?? null,
        timestamp: parsed?.timestamp,
        message: parsed?.message || `Test email endpoint returned HTTP ${res.status}.`,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'FAILED',
        message: err.message || 'Failed to execute diagnostic test email',
      };
    }
  },

  async updateDepartmentConfig(
    payload: {
      department: string;
      responsibleEmail?: string;
      departmentHeadEmail?: string;
      responsibleName?: string;
      active?: boolean;
      actor?: string;
    },
    url?: string
  ): Promise<{
    success: boolean;
    message: string;
    departments?: DepartmentDirectoryRow[];
    summary?: DepartmentDirectorySummary | null;
  }> {
    const targetUrl = (url || this.getBackendUrl()).trim();
    if (!targetUrl) {
      return { success: false, message: 'No Google Apps Script Web App URL configured.' };
    }
    try {
      const res = await fetchWithTimeout('/api/sheets/update-department', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: targetUrl,
          ...payload,
        }),
      });
      const { parsed } = await safeParseResponseJson(res);
      return {
        success: !!(res.ok && parsed?.success),
        message: parsed?.message || `Update department returned HTTP ${res.status}.`,
        departments: parsed?.departments,
        summary: parsed?.summary || null,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to update department email configuration',
      };
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
      const res = await fetchWithTimeout('/api/sheets/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webAppUrl: targetUrl, tickets }),
      });

      const { parsed, text, isHtml, contentType } = await safeParseResponseJson(res);
      if (res.ok && parsed && parsed.success) {
        return { success: true, message: parsed.message, details: parsed.backendResponse };
      }
      const diag = interpretProxyError(res, parsed, text, isHtml, contentType, 'Sync failed');
      return { success: false, message: diag.message, details: diag.details };
    } catch (err: any) {
      return { success: false, message: `Sync failed: ${err.message || 'Network error'}` };
    }
  },

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
