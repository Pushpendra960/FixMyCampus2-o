import { AIClassificationResult, CampusTicket, IssueCategory, TicketPriority } from '../types/campus';

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  matchedTicket?: CampusTicket;
  similarityScore: number;
  reason?: string;
}

const AI_CLASSIFY_TIMEOUT_MS = 28000;

const DUPLICATE_STOPWORDS = new Set([
  'about', 'after', 'also', 'always', 'area', 'around', 'been', 'being', 'both',
  'broken', 'building', 'campus', 'class', 'classes', 'classroom', 'could', 'damaged',
  'does', 'doing', 'during', 'every', 'faculty', 'fault', 'from', 'have', 'here',
  'into', 'issue', 'issues', 'just', 'large', 'lecture', 'main', 'make', 'morning',
  'need', 'needs', 'near', 'not', 'only', 'other', 'over', 'please', 'problem',
  'report', 'reported', 'right', 'room', 'same', 'some', 'student', 'students',
  'team', 'that', 'their', 'there', 'these', 'they', 'this', 'today', 'very',
  'want', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'working',
  'would', 'hall', 'complex', 'block', 'floor',
]);

function normalizeText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intelligent Rule-based & Semantic Classifier fallback.
 * Ensures instant classification when Gemini is unavailable or unconfigured.
 */
export function heuristicClassify(description: string, room: string, building: string): AIClassificationResult {
  const text = normalizeText(`${description || ''} ${room || ''} ${building || ''}`);

  let category: IssueCategory = 'Other';
  let recommendedDepartment = 'General Administration';
  let priority: TicketPriority = 'Medium';
  let aiSummary = '';
  let urgencyReason = '';
  let suggestedAction = '';
  let uncertainRouting = false;
  let routingNote: string | undefined;

  // 1. Detect Category & Department matching authoritative DepartmentDirectory
  if (
    text.includes('marker') ||
    text.includes('whiteboard') ||
    text.includes('eraser') ||
    text.includes('chalk') ||
    text.includes('duster') ||
    text.includes('stationery') ||
    text.includes('supplies') ||
    text.includes('stapler')
  ) {
    category = 'Classroom Supplies';
    recommendedDepartment = 'Classroom Supplies';
    suggestedAction = 'Deliver restock kit to teaching podium or classroom.';
  } else if (
    text.includes('projector') ||
    text.includes('hdmi') ||
    text.includes('screen') ||
    text.includes('audio') ||
    text.includes('mic') ||
    text.includes('microphone') ||
    text.includes('speaker') ||
    text.includes('display') ||
    text.includes('computer') ||
    text.includes('monitor') ||
    text.includes('wifi') ||
    text.includes('wi fi') ||
    text.includes('internet') ||
    text.includes('crestron')
  ) {
    category = 'IT / Audio-Visual Support';
    recommendedDepartment = 'IT / Audio-Visual Support';
    suggestedAction = 'Dispatch AV technician with diagnostic test kit and spare cables/lamp.';
  } else if (
    text.includes('spark') ||
    text.includes('wire') ||
    text.includes('wiring') ||
    text.includes('shock') ||
    text.includes('outlet') ||
    text.includes('socket') ||
    text.includes('switch') ||
    text.includes('breaker') ||
    text.includes('electricity') ||
    text.includes('power') ||
    text.includes('electrical') ||
    text.includes('power trip') ||
    text.includes('ballast')
  ) {
    category = 'Electrical Maintenance';
    recommendedDepartment = 'Electrical Maintenance';
    suggestedAction = 'Tag out electrical circuit breaker and dispatch licensed electrician.';
  } else if (
    text.includes('plumbing') ||
    text.includes('pipe') ||
    text.includes('faucet') ||
    text.includes('drain') ||
    text.includes('clog') ||
    text.includes('sink') ||
    text.includes('water leakage') ||
    text.includes('leak')
  ) {
    category = 'Plumbing / Maintenance';
    recommendedDepartment = 'Plumbing / Maintenance';
    suggestedAction = 'Shut off local isolation valve and dispatch plumbing technician.';
  } else if (
    text.includes('clean') ||
    text.includes('cleaning') ||
    text.includes('dirty') ||
    text.includes('dustbin') ||
    text.includes('trash') ||
    text.includes('garbage') ||
    text.includes('washroom') ||
    text.includes('restroom') ||
    text.includes('spill') ||
    text.includes('custodial') ||
    text.includes('smell') ||
    text.includes('odor') ||
    text.includes('dust') ||
    text.includes('toilet')
  ) {
    category = 'Housekeeping';
    recommendedDepartment = 'Housekeeping';
    suggestedAction = 'Dispatch housekeeping staff with sanitation equipment.';
  } else if (
    text.includes('chair') ||
    text.includes('desk') ||
    text.includes('table') ||
    text.includes('furniture') ||
    text.includes('fan') ||
    text.includes('light') ||
    text.includes('door') ||
    text.includes('lock') ||
    text.includes('window') ||
    text.includes('blind') ||
    text.includes('curtain') ||
    text.includes('ceiling') ||
    text.includes('tile') ||
    text.includes('ac') ||
    text.includes('air condition') ||
    text.includes('hvac') ||
    text.includes('cooling') ||
    text.includes('heating') ||
    text.includes('carpet') ||
    text.includes('floor') ||
    text.includes('broken')
  ) {
    category = 'Facilities / Maintenance';
    recommendedDepartment = 'Facilities / Maintenance';
    suggestedAction = 'Schedule facilities work order inspection and physical triage.';
  } else {
    suggestedAction = 'Review ticket details and assign to the responsible campus team.';
    uncertainRouting = true;
    routingNote =
      'No specialized equipment or hazard keywords matched; routed to General Administration for review.';
  }

  // 2. Compute Smart Priority
  const isSafetyHazard =
    text.includes('sharp') ||
    text.includes('spark') ||
    text.includes('smoke') ||
    text.includes('fire') ||
    text.includes('shock') ||
    text.includes('exposed wire') ||
    text.includes('bleeding') ||
    text.includes('slip') ||
    text.includes('flooding') ||
    text.includes('shattered') ||
    text.includes('broken glass') ||
    text.includes('hazard');

  const isSevereDisruption =
    text.includes('flicker') ||
    text.includes('exam') ||
    text.includes('lecture') ||
    text.includes('cannot teach') ||
    text.includes('cut out') ||
    text.includes('shut down') ||
    text.includes('blackout') ||
    text.includes('emergency') ||
    text.includes('drip') ||
    text.includes('leak') ||
    text.includes('stuck');

  if (isSafetyHazard) {
    priority = 'Critical';
    urgencyReason = 'Immediate physical safety or structural hazard flagged. Poses risk of personal injury.';
  } else if (isSevereDisruption) {
    priority = 'High';
    urgencyReason = 'Direct interference with ongoing educational sessions or active classroom instructional delivery.';
  } else if (category === 'Classroom Supplies' || text.includes('squeak') || text.includes('scuff')) {
    priority = 'Low';
    urgencyReason = 'Non-hazardous inconvenience; basic instructional consumables or minor cosmetic item.';
  } else {
    priority = 'Medium';
    urgencyReason = 'Operational degradation requiring standard department intervention within 24 hours.';
  }

  // 3. Generate concise AI summary
  const cleanDesc = String(description || '').replace(/[\r\n]+/g, ' ').trim();
  if (cleanDesc.length < 60) {
    aiSummary = cleanDesc;
  } else {
    aiSummary = cleanDesc.slice(0, 75).trim() + '...';
  }

  return {
    category,
    recommendedDepartment,
    priority,
    aiSummary: aiSummary || 'Campus facility maintenance report',
    urgencyReason: urgencyReason || 'Standard response priority based on automated impact assessment.',
    suggestedAction,
    classificationSource: 'heuristic-fallback',
    usedFallback: true,
    uncertainRouting,
    routingNote,
  };
}

/**
 * Check for duplicate issues in the same room & category using stopword-filtered keyword overlap
 */
export function checkDuplicateTickets(
  newRoom: string,
  newCategory: IssueCategory,
  newDescription: string,
  activeTickets: CampusTicket[]
): DuplicateCheckResult {
  const roomClean = String(newRoom || '').trim().toLowerCase();
  const descClean = normalizeText(newDescription || '');

  if (!roomClean || !descClean || !Array.isArray(activeTickets) || activeTickets.length === 0) {
    return { hasDuplicate: false, similarityScore: 0 };
  }

  // Filter tickets that are not closed or resolved
  const openTicketsInRoom = activeTickets.filter(
    (t) =>
      t &&
      String(t.roomNumber || '').trim().toLowerCase() === roomClean &&
      t.status !== 'Closed' &&
      t.status !== 'Resolved'
  );

  if (openTicketsInRoom.length === 0) {
    return { hasDuplicate: false, similarityScore: 0 };
  }

  // Extract unique meaningful domain/symptom keywords (filtering generic words like "broken", "room", "please")
  const meaningfulWords = Array.from(
    new Set(
      descClean
        .split(/\s+/)
        .filter((w) => w.length > 2 && !DUPLICATE_STOPWORDS.has(w))
    )
  );

  if (meaningfulWords.length === 0) {
    return { hasDuplicate: false, similarityScore: 0 };
  }

  let bestMatch: DuplicateCheckResult = { hasDuplicate: false, similarityScore: 0 };

  for (const existing of openTicketsInRoom) {
    const existingTokens = new Set(
      normalizeText(`${existing.description || ''} ${existing.aiSummary || ''}`)
        .split(/\s+/)
        .filter((w) => w.length > 2 && !DUPLICATE_STOPWORDS.has(w))
    );

    let matchedWords = 0;
    for (const word of meaningfulWords) {
      if (existingTokens.has(word)) {
        matchedWords++;
      } else {
        // Check stem prefix match for closely related inflections (e.g., flicker / flickering)
        for (const ext of existingTokens) {
          if (word.length >= 5 && ext.length >= 5 && (ext.startsWith(word.slice(0, 5)) || word.startsWith(ext.slice(0, 5)))) {
            matchedWords++;
            break;
          }
        }
      }
    }

    const overlapRatio = matchedWords / meaningfulWords.length;
    const sameCategory =
      String(existing.category || '').toLowerCase().replace(/[^a-z]/g, '') ===
      String(newCategory || '').toLowerCase().replace(/[^a-z]/g, '');

    // Require genuine lexical overlap (at least 1 substantive shared keyword when category matches,
    // or strong >= 0.45 overlap across descriptions even if category differs)
    if (matchedWords === 0) continue;
    if (sameCategory && overlapRatio < 0.18 && matchedWords < 2) continue;
    if (!sameCategory && (matchedWords < 2 || overlapRatio < 0.4)) continue;

    let score = sameCategory ? 42 : 12;
    score += Math.min(56, Math.round(overlapRatio * 70));

    if (score >= 60 && score > bestMatch.similarityScore) {
      bestMatch = {
        hasDuplicate: true,
        matchedTicket: existing,
        similarityScore: Math.min(score, 98),
        reason: `Active ticket ${existing.id} (${existing.category}) is already open for ${existing.roomNumber}: "${existing.aiSummary}"`,
      };
    }
  }

  return bestMatch;
}

/**
 * Server/Client hybrid AI Classification with timeout and safe fallback
 */
export async function analyzeIssueWithAI(
  description: string,
  room: string,
  building: string
): Promise<AIClassificationResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CLASSIFY_TIMEOUT_MS);

  try {
    const res = await fetch('/api/ai/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, room, building }),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.category) {
        return data as AIClassificationResult;
      }
    }

    const errPayload = await res.json().catch(() => null);
    return {
      ...heuristicClassify(description, room, building),
      fallbackReason:
        errPayload?.error ||
        `Classification endpoint returned HTTP ${res.status}; used local rule engine.`,
    };
  } catch (err: any) {
    const local = heuristicClassify(description, room, building);
    const isTimeout = err?.name === 'AbortError';
    return {
      ...local,
      fallbackReason: isTimeout
        ? 'AI classification timed out; used local rule engine.'
        : err?.message || 'Unable to reach /api/ai/classify',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
