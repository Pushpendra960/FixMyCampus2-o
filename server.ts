import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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

// AI Classification Endpoint
app.post('/api/ai/classify', async (req: Request, res: Response) => {
  const { description, room, building } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description is required' });
  }

  if (aiClient) {
    try {
      const prompt = `You are the AI triage coordinator for FixMyCampus 2.0 at a university.
Analyze this faculty complaint:
- Building: "${building || 'Campus'}"
- Room: "${room || 'Classroom'}"
- Description: "${description}"

Classify into one of these exact categories:
['IT / Audio-Visual Support', 'Classroom Supplies', 'Facilities / Maintenance', 'Electrical Maintenance', 'Housekeeping', 'Other']

Recommend one of these departments matching the campus DepartmentDirectory:
['IT / Audio-Visual Support', 'Classroom Supplies', 'Facilities / Maintenance', 'Electrical Maintenance', 'Housekeeping', 'General Administration']

Assign a priority:
['Low', 'Medium', 'High', 'Critical'] (Use Critical for physical hazards/electrical sparks/severe flooding; High for active lecture disruptions like projector flicker; Medium for standard repairs; Low for non-urgent supplies/cosmetics).

Provide a 1-sentence clean summary (aiSummary) and an urgencyReason.
Respond ONLY with a JSON object in this format:
{
  "category": "IT / Audio-Visual Support",
  "recommendedDepartment": "IT / Audio-Visual Support",
  "priority": "High",
  "aiSummary": "Summary text",
  "urgencyReason": "Reason text",
  "suggestedAction": "Immediate step"
}`;

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI classification request timed out')), 3500)
      );

      const apiPromise = aiClient.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const response: any = await Promise.race([apiPromise, timeoutPromise]);
      const text = response.text?.trim();
      if (text) {
        const parsed = JSON.parse(text);
        return res.json(parsed);
      }
    } catch (apiErr) {
      console.warn('Gemini API call skipped/failed, using fast rule engine:', apiErr);
    }
  }

  // Server-side fallback rule engine
  const text = ((description || '') + ' ' + (room || '') + ' ' + (building || '')).toLowerCase();
  let category = 'Other';
  let recommendedDepartment = 'General Administration';
  let priority = 'Medium';
  let urgencyReason = 'Standard response priority based on automated impact assessment.';
  let suggestedAction = 'Dispatch service technician.';

  if (text.includes('marker') || text.includes('whiteboard') || text.includes('eraser') || text.includes('chalk') || text.includes('duster') || text.includes('stationery')) {
    category = 'Classroom Supplies';
    recommendedDepartment = 'Classroom Supplies';
    priority = 'Medium';
    urgencyReason = 'Consumables exhausted; restricts instructional board work.';
    suggestedAction = 'Dispatch restock pouch with whiteboard markers.';
  } else if (text.includes('projector') || text.includes('hdmi') || text.includes('mic') || text.includes('screen') || text.includes('display') || text.includes('audio')) {
    category = 'IT / Audio-Visual Support';
    recommendedDepartment = 'IT / Audio-Visual Support';
    priority = 'High';
    urgencyReason = 'Direct disruption to multimedia classroom presentation.';
    suggestedAction = 'Inspect projector bulb and HDMI balun matrix.';
  } else if (text.includes('spark') || text.includes('wire') || text.includes('socket') || text.includes('switch') || text.includes('electrical') || text.includes('power')) {
    category = 'Electrical Maintenance';
    recommendedDepartment = 'Electrical Maintenance';
    priority = 'High';
    urgencyReason = 'Electrical infrastructure malfunction or safety hazard.';
    suggestedAction = 'Tag out electrical circuit and dispatch licensed electrician.';
  } else if (text.includes('clean') || text.includes('dirty') || text.includes('trash') || text.includes('leak') || text.includes('spill') || text.includes('washroom')) {
    category = 'Housekeeping';
    recommendedDepartment = 'Housekeeping';
    priority = text.includes('leak') ? 'High' : 'Medium';
    urgencyReason = 'Sanitation and custodial maintenance required.';
    suggestedAction = 'Dispatch custodial crew for cleanup.';
  } else if (text.includes('chair') || text.includes('desk') || text.includes('door') || text.includes('ac') || text.includes('window') || text.includes('table') || text.includes('fan')) {
    category = 'Facilities / Maintenance';
    recommendedDepartment = 'Facilities / Maintenance';
    priority = text.includes('sharp') || text.includes('hazard') ? 'High' : 'Medium';
    urgencyReason = 'Physical fixture malfunction in learning environment.';
    suggestedAction = 'Tag out broken asset and replace components.';
  }

  const aiSummary = description.length > 70 ? description.slice(0, 70) + '...' : description;

  return res.json({
    category,
    recommendedDepartment,
    priority,
    aiSummary,
    urgencyReason,
    suggestedAction,
  });
});

// Health & Status check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'FixMyCampus 2.0 Engine',
    hasGeminiKey: !!aiClient,
    environment: 'Demo / Sandbox',
  });
});

// Google Apps Script Proxy: Test Connection
app.post('/api/sheets/test-connection', async (req: Request, res: Response) => {
  const { webAppUrl } = req.body;
  if (!webAppUrl || typeof webAppUrl !== 'string' || !webAppUrl.startsWith('https://script.google.com/')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid URL. Please enter a valid Google Apps Script Web App URL starting with https://script.google.com/',
    });
  }

  try {
    // Send health check GET request with action=health
    const testUrl = webAppUrl.includes('?') ? `${webAppUrl}&action=health` : `${webAppUrl}?action=health`;
    const response = await fetch(testUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Might be plain text
    }

    if (response.ok && parsed && parsed.success) {
      return res.json({
        success: true,
        message: parsed.message || 'Google Apps Script backend is online and reachable.',
        details: parsed,
      });
    } else if (parsed && parsed.success === false) {
      return res.status(400).json({
        success: false,
        message: parsed.message || 'Backend returned an error.',
        details: parsed,
      });
    } else {
      return res.status(response.status).json({
        success: false,
        message: `Backend responded with HTTP status ${response.status}: ${response.statusText}`,
        details: text.slice(0, 300),
      });
    }
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
  if (!webAppUrl || typeof webAppUrl !== 'string' || !webAppUrl.startsWith('https://script.google.com/')) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }
  if (!ticket) {
    return res.status(400).json({ success: false, message: 'Ticket data is required.' });
  }

  // Exact action: createTicket
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

  try {
    const response = await fetch(webAppUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // text response
    }

    if (response.ok && parsed && parsed.success) {
      return res.json({
        success: true,
        message: 'Ticket recorded successfully in Google Sheets backend.',
        ticketId: parsed.ticketId,
        notification: parsed.notification,
        backendResponse: parsed,
      });
    } else if (parsed && parsed.success === false) {
      return res.status(422).json({
        success: false,
        message: parsed.message || 'Google Apps Script reported an execution error.',
        details: parsed,
      });
    } else {
      return res.status(response.status).json({
        success: false,
        message: `Google Apps Script returned HTTP ${response.status}: ${response.statusText}`,
        details: text.slice(0, 300),
      });
    }
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to transmit ticket to Google Apps Script: ${error.message || 'Network error'}`,
    });
  }
});

// Google Apps Script Proxy: Update Ticket Status (action: updateStatus)
app.post('/api/sheets/update-status', async (req: Request, res: Response) => {
  const { webAppUrl, ticketId, status, resolutionNotes, evidenceReference } = req.body;
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com/')) {
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
  };

  try {
    const response = await fetch(webAppUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // text response
    }

    if (response.ok && parsed && parsed.success) {
      return res.json({
        success: true,
        message: `Ticket ${ticketId} status updated to ${status} in Google Sheets.`,
        backendResponse: parsed,
      });
    } else {
      return res.status(422).json({
        success: false,
        message: parsed?.message || `Failed to update status: HTTP ${response.status}`,
        details: parsed,
      });
    }
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
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com/')) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const fetchUrl = webAppUrl.includes('?') ? `${webAppUrl}&action=getTickets` : `${webAppUrl}?action=getTickets`;
    const response = await fetch(fetchUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    const data = await response.json();
    if (data && data.success) {
      return res.json({
        success: true,
        tickets: data.tickets || [],
      });
    } else {
      return res.status(400).json({
        success: false,
        message: data?.message || 'Failed to fetch tickets from Google Sheets.',
      });
    }
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
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com/')) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const fetchUrl = webAppUrl.includes('?') ? `${webAppUrl}&action=getDepartments` : `${webAppUrl}?action=getDepartments`;
    const response = await fetch(fetchUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    const data = await response.json();
    if (data && data.success && Array.isArray(data.departments)) {
      // Normalize header keys and string values by trimming whitespace & newlines
      const cleaned = data.departments.map((dept: any) => {
        const item: Record<string, any> = {};
        for (const [k, v] of Object.entries(dept)) {
          const cleanKey = k.trim();
          item[cleanKey] = typeof v === 'string' ? v.trim() : v;
        }
        return item;
      });

      return res.json({
        success: true,
        departments: cleaned,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: data?.message || 'Failed to fetch department directory from Google Sheets.',
      });
    }
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
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com/')) {
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

    const response = await fetch(webAppUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.json({
      success: true,
      message: data.message || `Successfully synced ${tickets?.length || 0} tickets to Google Sheets.`,
      backendResponse: data,
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
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com/')) {
    return res.status(400).json({
      success: false,
      message: 'A valid Google Apps Script Web App URL is required.',
    });
  }

  try {
    const action = logType ? `get${logType}` : 'getLogs';
    const fetchUrl = webAppUrl.includes('?') ? `${webAppUrl}&action=${action}` : `${webAppUrl}?action=${action}`;

    const response = await fetch(fetchUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    const data = await response.json();
    if (data && data.success) {
      return res.json(data);
    } else {
      return res.status(400).json({
        success: false,
        message: data?.message || 'Failed to fetch logs from Google Sheets.',
      });
    }
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
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com/')) {
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

    const response = await fetch(webAppUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: `Failed to record evidence to Google Sheets: ${err.message || 'Network error'}`,
    });
  }
});

async function startServer() {
  // Mount Vite development middlewares
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FixMyCampus 2.0 dev server listening on port ${PORT}`);
  });
}

startServer();
