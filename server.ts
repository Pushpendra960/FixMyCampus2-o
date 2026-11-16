import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const GEMINI_MODEL = 'gemini-4-hydrogen';

app.use(express.json({ limit: '10mb' }));

// Initialize Gemini Client if key exists
let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
  try {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.warn('Gemini client initialization notice:', err);
  }
}

const VALID_CATEGORIES = [
  'IT / Audio-Visual Support',
  'Classroom Supplies',
  'Facilities / Maintenance',
  'Electrical Maintenance',
  'Housekeeping',
  'Other',
];

const VALID_DEPARTMENTS = [
  'IT / Audio-Visual Support',
  'Classroom Supplies',
  'Facilities / Maintenance',
  'Electrical Maintenance',
  'Housekeeping',
  'General Administration',
];

const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

function serverFallbackClassify(description: string, room?: string, building?: string) {
  const text = `${description || ''} ${room || ''} ${building || ''}`.toLowerCase();
  let category = 'Other';
  let recommendedDepartment = 'General Administration';
  let priority = 'Medium';
  let urgencyReason = 'Standard response priority based on automated impact assessment.';
  let suggestedAction = 'Dispatch service technician.';

  if (
    text.includes('marker') ||
    text.includes('whiteboard') ||
    text.includes('eraser') ||
    text.includes('chalk') ||
    text.includes('duster') ||
    text.includes('stationery') ||
    text.includes('supplies')
  ) {
    category = 'Classroom Supplies';
    recommendedDepartment = 'Classroom Supplies';
    suggestedAction = 'Dispatch restock pouch with whiteboard markers.';
  } else if (
    text.includes('projector') ||
    text.includes('hdmi') ||
    text.includes('mic') ||
    text.includes('microphone') ||
    text.includes('screen') ||
    text.includes('display') ||
    text.includes('audio') ||
    text.includes('speaker') ||
    text.includes('wifi') ||
    text.includes('crestron')
  ) {
    category = 'IT / Audio-Visual Support';
    recommendedDepartment = 'IT / Audio-Visual Support';
    suggestedAction = 'Inspect projector bulb, display signal, and HDMI matrix.';
  } else if (
    text.includes('spark') ||
    text.includes('wire') ||
    text.includes('socket') ||
    text.includes('switch') ||
    text.includes('electrical') ||
    text.includes('power') ||
    text.includes('breaker') ||
    text.includes('shock')
  ) {
    category = 'Electrical Maintenance';
    recommendedDepartment = 'Electrical Maintenance';
    suggestedAction = 'Tag out electrical circuit and dispatch licensed electrician.';
  } else if (
    text.includes('clean') ||
    text.includes('dirty') ||
    text.includes('trash') ||
    text.includes('leak') ||
    text.includes('spill') ||
    text.includes('washroom') ||
    text.includes('toilet') ||
    text.includes('sink')
  ) {
    category = 'Housekeeping';
    recommendedDepartment = 'Housekeeping';
    suggestedAction = 'Dispatch custodial crew for cleanup and sanitization.';
  } else if (
    text.includes('chair') ||
    text.includes('desk') ||
    text.includes('door') ||
    text.includes('ac') ||
    text.includes('hvac') ||
    text.includes('window') ||
    text.includes('table') ||
    text.includes('fan') ||
    text.includes('broken')
  ) {
    category = 'Facilities / Maintenance';
    recommendedDepartment = 'Facilities / Maintenance';
    suggestedAction = 'Tag out broken asset and schedule physical repair.';
  }

  const isSafetyHazard =
    text.includes('sharp') ||
    text.includes('spark') ||
    text.includes('smoke') ||
    text.includes('fire') ||
    text.includes('shock') ||
    text.includes('exposed wire') ||
    text.includes('bleeding') ||
    text.includes('flooding') ||
    text.includes('broken glass') ||
    text.includes('hazard');

  const isSevereDisruption =
    text.includes('flicker') ||
    text.includes('exam') ||
    text.includes('lecture') ||
    text.includes('cannot teach') ||
    text.includes('shut down') ||
    text.includes('leak') ||
    text.includes('emergency');

  if (isSafetyHazard) {
    priority = 'Critical';
    urgencyReason = 'Immediate physical safety or structural hazard flagged.';
  } else if (isSevereDisruption) {
    priority = 'High';
    urgencyReason = 'Direct disruption to active classroom instruction or facility operations.';
  } else if (category === 'Classroom Supplies') {
    priority = 'Low';
    urgencyReason = 'Non-hazardous consumable restock required.';
  }

  const cleanDesc = String(description || '').replace(/[\r\n]+/g, ' ').trim();
  const aiSummary = cleanDesc.length > 75 ? `${cleanDesc.slice(0, 75).trim()}...` : cleanDesc;

  return {
    category,
    recommendedDepartment,
    priority,
    aiSummary,
    urgencyReason,
    suggestedAction,
  };
}

function isValidAppsScriptUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.trim().startsWith('https://script.google.com/') &&
    url.trim().length > 30
  );
}

async function callAppsScript(
  webAppUrl: string,
  method: 'GET' | 'POST',
  actionOrPayload: string | Record<string, any>
): Promise<{
  ok: boolean;
  httpStatus: number;
  statusText: string;
  parsed: any | null;
  rawText: string;
}> {
  const cleanUrl = webAppUrl.trim();
  let response: globalThis.Response;

  if (method === 'GET') {
    const action = typeof actionOrPayload === 'string' ? actionOrPayload : 'health';
    const targetUrl = cleanUrl.includes('?')
      ? `${cleanUrl}&action=${encodeURIComponent(action)}`
      : `${cleanUrl}?action=${encodeURIComponent(action)}`;
    response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
    });
  } else {
    response = await fetch(cleanUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(actionOrPayload),
    });
  }

  const rawText = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  return {
    ok: response.ok,
    httpStatus: response.status,
    statusText: response.statusText,
    parsed,
    rawText,
  };
}

// AI Classification Endpoint
app.post('/api/ai/classify', async (req: Request, res: Response) => {
  const { description, room, building } = req.body;

  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }

  let fallbackReason: string | undefined;

  if (aiClient) {
    try {
      const prompt = `You are the AI triage coordinator for FixMyCampus 2.0 at a university.
Analyze this faculty complaint:
- Building: "${building || 'Campus'}"
- Room: "${room || 'Classroom'}"
- Description: "${description}"

Choose:
- category: one of ${JSON.stringify(VALID_CATEGORIES)}
- recommendedDepartment: one of ${JSON.stringify(VALID_DEPARTMENTS)}
- priority: one of ${JSON.stringify(VALID_PRIORITIES)} (Critical for physical safety hazards, sparks, sharp edges, smoke, or flooding; High for active lecture disruptions like projector failure or leaks; Medium for standard repairs; Low for non-urgent consumables/supplies)
- aiSummary: 1 concise sentence summarizing the issue
- urgencyReason: brief explanation of priority
- suggestedAction: immediate dispatch step`;

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini AI classification request timed out after 10s')), 10000)
      );

      const apiPromise = aiClient.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              recommendedDepartment: { type: Type.STRING },
              priority: { type: Type.STRING },
              aiSummary: { type: Type.STRING },
              urgencyReason: { type: Type.STRING },
              suggestedAction: { type: Type.STRING },
            },
            required: ['category', 'recommendedDepartment', 'priority', 'aiSummary', 'urgencyReason', 'suggestedAction'],
          },
        },
      });

      const response: any = await Promise.race([apiPromise, timeoutPromise]);
      const text = response.text?.trim();
      if (text) {
        const parsed = JSON.parse(text);
        const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'Other';
        const recommendedDepartment = VALID_DEPARTMENTS.includes(parsed.recommendedDepartment)
          ? parsed.recommendedDepartment
          : 'General Administration';
        const priority = VALID_PRIORITIES.includes(parsed.priority) ? parsed.priority : 'Medium';

        return res.json({
          category,
          recommendedDepartment,
          priority,
          aiSummary: parsed.aiSummary || description.slice(0, 75),
          urgencyReason: parsed.urgencyReason || 'Evaluated by Gemini AI triage.',
          suggestedAction: parsed.suggestedAction || 'Dispatch department technician.',
          classificationSource: 'gemini',
          usedFallback: false,
          model: GEMINI_MODEL,
        });
      }
      fallbackReason = 'Gemini returned an empty response.';
    } catch (apiErr: any) {
      fallbackReason = apiErr?.message || 'Gemini API request failed.';
      console.warn('Gemini API call skipped/failed, using rule engine:', fallbackReason);
    }
  } else {
    fallbackReason = 'GEMINI_API_KEY is not configured in server environment.';
  }

  const fallback = serverFallbackClassify(description, room, building);
  return res.json({
    ...fallback,
    classificationSource: 'heuristic-fallback',
    usedFallback: true,
    fallbackReason,
  });
});

// Health & Status check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'FixMyCampus 2.0 Engine',
    hasGeminiKey: !!aiClient,
    geminiModel: GEMINI_MODEL,
    environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Development',
  });
});

// Google Apps Script Proxy: Test Connection
app.post('/api/sheets/test-connection', async (req: Request, res: Response) => {
  const { webAppUrl } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid URL. Please enter a valid Google Apps Script Web App URL starting with https://script.google.com/',
    });
  }

  try {
    const { ok, httpStatus, statusText, parsed, rawText } = await callAppsScript(webAppUrl, 'GET', 'health');

    if (ok && parsed && parsed.success) {
      if (parsed.spreadsheetConnected === false) {
        return res.status(422).json({
          success: false,
          message:
            parsed.diagnostic ||
            'Apps Script Web App responded, but spreadsheetConnected is false. Configure SPREADSHEET_ID in Code.gs and re-deploy.',
          details: parsed,
        });
      }

      return res.json({
        success: true,
        message: parsed.diagnostic || parsed.message || 'Google Apps Script backend and Google Sheet are connected.',
        details: parsed,
      });
    }

    if (parsed && parsed.success === false) {
      return res.status(422).json({
        success: false,
        message: parsed.message || 'Backend returned an error.',
        details: parsed,
      });
    }

    const isHtmlAuthPage = rawText.trim().startsWith('<!DOCTYPE') || rawText.includes('<html');
    return res.status(ok ? 502 : httpStatus).json({
      success: false,
      message: isHtmlAuthPage
        ? 'Apps Script returned HTML instead of JSON. Ensure Web App access is set to "Anyone" and a new deployment version is published.'
        : `Backend responded with HTTP ${httpStatus}: ${statusText}`,
      details: rawText.slice(0, 300),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to connect to Google Apps Script: ${error.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Submit Ticket (action: createTicket)
app.post('/api/sheets/submit', async (req: Request, res: Response) => {
  const { webAppUrl, ticket } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }
  if (!ticket) {
    return res.status(400).json({ success: false, message: 'Ticket data is required.' });
  }

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
    duplicateOf: ticket.isDuplicateOf || '',
  };

  try {
    const { ok, httpStatus, statusText, parsed, rawText } = await callAppsScript(webAppUrl, 'POST', payload);

    if (ok && parsed && parsed.success) {
      return res.json({
        success: true,
        message: 'Ticket recorded successfully in Google Sheets backend.',
        ticketId: parsed.ticketId,
        department: parsed.department,
        status: parsed.status,
        requiresManualReview: !!parsed.requiresManualReview,
        notification: parsed.notification,
        backendResponse: parsed,
      });
    }

    if (parsed && parsed.success === false) {
      return res.status(422).json({
        success: false,
        message: parsed.message || 'Google Apps Script reported an execution error.',
        details: parsed,
      });
    }

    return res.status(ok ? 502 : httpStatus).json({
      success: false,
      message: `Google Apps Script returned HTTP ${httpStatus}: ${statusText}`,
      details: rawText.slice(0, 300),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to transmit ticket to Google Apps Script: ${error.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Update Ticket Status (action: updateStatus)
app.post('/api/sheets/update-status', async (req: Request, res: Response) => {
  const { webAppUrl, ticketId, status, resolutionNotes, evidenceReference, updatedBy, assignedTo } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }
  if (!ticketId || !status) {
    return res.status(400).json({ success: false, message: 'ticketId and status are required.' });
  }

  const payload = {
    action: 'updateStatus',
    ticketId,
    status,
    resolutionNotes: resolutionNotes || '',
    evidenceReference: evidenceReference || '',
    updatedBy: updatedBy || 'Staff',
    assignedTo: assignedTo || '',
  };

  try {
    const { ok, httpStatus, parsed, rawText } = await callAppsScript(webAppUrl, 'POST', payload);

    if (ok && parsed && parsed.success) {
      return res.json({
        success: true,
        message: `Ticket ${ticketId} status updated to ${status} in Google Sheets.`,
        backendResponse: parsed,
      });
    }

    return res.status(422).json({
      success: false,
      message: parsed?.message || `Failed to update status: HTTP ${httpStatus}`,
      details: parsed || rawText.slice(0, 300),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to update ticket status on Google Apps Script: ${error.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Fetch Live Tickets (action: getTickets)
app.post('/api/sheets/fetch-tickets', async (req: Request, res: Response) => {
  const { webAppUrl } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const { ok, httpStatus, parsed, rawText } = await callAppsScript(webAppUrl, 'GET', 'getTickets');
    if (ok && parsed && parsed.success) {
      return res.json({
        success: true,
        tickets: parsed.tickets || [],
      });
    }

    return res.status(422).json({
      success: false,
      message: parsed?.message || `Failed to fetch tickets from Google Sheets (HTTP ${httpStatus}).`,
      details: parsed || rawText.slice(0, 300),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to query Google Apps Script: ${error.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Fetch Authoritative Department Directory (action: getDepartments)
app.post('/api/sheets/fetch-departments', async (req: Request, res: Response) => {
  const { webAppUrl } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const { ok, httpStatus, parsed, rawText } = await callAppsScript(webAppUrl, 'GET', 'getDepartments');
    if (ok && parsed && parsed.success && Array.isArray(parsed.departments)) {
      const cleaned = parsed.departments.map((dept: any) => {
        const item: Record<string, any> = {};
        for (const [k, v] of Object.entries(dept)) {
          item[k.trim()] = typeof v === 'string' ? v.trim() : v;
        }
        return item;
      });

      return res.json({
        success: true,
        departments: cleaned,
      });
    }

    return res.status(422).json({
      success: false,
      message: parsed?.message || `Failed to fetch department directory (HTTP ${httpStatus}).`,
      details: parsed || rawText.slice(0, 300),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to query department directory: ${error.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Bulk Synchronize Tickets (action: syncAll)
app.post('/api/sheets/sync-all', async (req: Request, res: Response) => {
  const { webAppUrl, tickets } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const payload = {
      action: 'syncAll',
      tickets: tickets || [],
    };

    const { ok, httpStatus, parsed, rawText } = await callAppsScript(webAppUrl, 'POST', payload);
    if (ok && parsed && parsed.success) {
      return res.json({
        success: true,
        message: parsed.message || `Successfully synced ${tickets?.length || 0} tickets to Google Sheets.`,
        backendResponse: parsed,
      });
    }

    return res.status(422).json({
      success: false,
      message: parsed?.message || `Failed to synchronize tickets (HTTP ${httpStatus}).`,
      details: parsed || rawText.slice(0, 300),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to synchronize tickets: ${err.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Fetch Live Sheet Logs (action: getLogs / getNotificationLogs / getAuditLogs / getEvidence)
app.post('/api/sheets/fetch-logs', async (req: Request, res: Response) => {
  const { webAppUrl, logType } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const actionMap: Record<string, string> = {
      NotificationLogs: 'getNotificationLogs',
      AuditLogs: 'getAuditLogs',
      ResolutionEvidence: 'getEvidence',
    };
    const action = logType ? (actionMap[logType] || `get${logType}`) : 'getLogs';
    const { ok, httpStatus, parsed, rawText } = await callAppsScript(webAppUrl, 'GET', action);

    if (ok && parsed && parsed.success) {
      return res.json(parsed);
    }

    return res.status(422).json({
      success: false,
      message: parsed?.message || `Failed to fetch logs from Google Sheets (HTTP ${httpStatus}).`,
      details: parsed || rawText.slice(0, 300),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to fetch logs from backend: ${err.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Add Resolution Evidence (action: addEvidence)
app.post('/api/sheets/add-evidence', async (req: Request, res: Response) => {
  const { webAppUrl, evidence } = req.body;
  if (!isValidAppsScriptUrl(webAppUrl)) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const payload = {
      action: 'addEvidence',
      ...(evidence || {}),
    };

    const { ok, httpStatus, parsed, rawText } = await callAppsScript(webAppUrl, 'POST', payload);
    if (ok && parsed && parsed.success) {
      return res.json(parsed);
    }

    return res.status(422).json({
      success: false,
      message: parsed?.message || `Failed to record evidence (HTTP ${httpStatus}).`,
      details: parsed || rawText.slice(0, 300),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to record evidence to Google Sheets: ${err.message || 'Network error'}`,
    });
  }
});

async function startServer() {
  const distDir = path.resolve(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FixMyCampus 2.0 server listening on port ${PORT}`);
  });
}

startServer();
