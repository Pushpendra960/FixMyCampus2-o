import { AIClassificationResult, CampusTicket, IssueCategory, TicketPriority } from '../types/campus';

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  matchedTicket?: CampusTicket;
  similarityScore: number;
  reason?: string;
}

/**
 * Intelligent Rule-based & Semantic Classifier fallback
 * Ensures instant classification and zero-failure hackathon demonstrations
 */
export function heuristicClassify(description: string, room: string, building: string): AIClassificationResult {
  const text = (description + ' ' + room + ' ' + building).toLowerCase();

  let category: IssueCategory = 'Other';
  let recommendedDepartment = 'General Administration';
  let priority: TicketPriority = 'Medium';
  let aiSummary = '';
  let urgencyReason = '';
  let suggestedAction = '';

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
    text.includes('clean') ||
    text.includes('cleaning') ||
    text.includes('dirty') ||
    text.includes('dustbin') ||
    text.includes('trash') ||
    text.includes('garbage') ||
    text.includes('washroom') ||
    text.includes('spill') ||
    text.includes('custodial') ||
    text.includes('smell') ||
    text.includes('odor') ||
    text.includes('dust') ||
    text.includes('water leakage') ||
    text.includes('leak') ||
    text.includes('sink') ||
    text.includes('drain') ||
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
  }

  // 2. Compute Smart Priority
  const isSafetyHazard =
    text.includes('sharp') ||
    text.includes('spark') ||
    text.includes('smoke') ||
    text.includes('fire') ||
    text.includes('exposed wire') ||
    text.includes('cut') ||
    text.includes('bleeding') ||
    text.includes('slip') ||
    text.includes('flooding') ||
    text.includes('shattered') ||
    text.includes('broken glass');

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
  const cleanDesc = description.replace(/[\r\n]+/g, ' ').trim();
  if (cleanDesc.length < 60) {
    aiSummary = cleanDesc;
  } else {
    // extract key phrase
    aiSummary = cleanDesc.slice(0, 75).trim() + '...';
  }

  return {
    category,
    recommendedDepartment,
    priority,
    aiSummary: aiSummary || 'Campus facility maintenance report',
    urgencyReason: urgencyReason || 'Standard response priority based on automated impact assessment.',
    suggestedAction,
  };
}

/**
 * Check for duplicate issues in the same room & category
 */
export function checkDuplicateTickets(
  newRoom: string,
  newCategory: IssueCategory,
  newDescription: string,
  activeTickets: CampusTicket[]
): DuplicateCheckResult {
  const roomClean = newRoom.trim().toLowerCase();
  const descClean = newDescription.trim().toLowerCase();

  // Filter tickets that are not closed or resolved
  const openTicketsInRoom = activeTickets.filter(
    (t) =>
      t.roomNumber.toLowerCase() === roomClean &&
      t.status !== 'Closed' &&
      t.status !== 'Resolved'
  );

  if (openTicketsInRoom.length === 0) {
    return { hasDuplicate: false, similarityScore: 0 };
  }

  // Look for category match or keyword overlap
  const words = descClean.split(/\s+/).filter((w) => w.length > 3);

  for (const existing of openTicketsInRoom) {
    let score = 0;
    const existingDesc = existing.description.toLowerCase();

    // Exact category match gives 45% base score
    if (existing.category === newCategory) {
      score += 45;
    }

    // Keyword matches
    let matchedWords = 0;
    for (const word of words) {
      if (existingDesc.includes(word)) {
        matchedWords++;
      }
    }

    if (words.length > 0) {
      score += Math.min(50, Math.round((matchedWords / words.length) * 55));
    }

    if (score >= 60) {
      return {
        hasDuplicate: true,
        matchedTicket: existing,
        similarityScore: Math.min(score, 98),
        reason: `Active ticket ${existing.id} (${existing.category}) is already open for ${existing.roomNumber}: "${existing.aiSummary}"`,
      };
    }
  }

  return { hasDuplicate: false, similarityScore: 0 };
}

/**
 * Server/Client hybrid AI Classification
 */
export async function analyzeIssueWithAI(
  description: string,
  room: string,
  building: string
): Promise<AIClassificationResult> {
  try {
    const res = await fetch('/api/ai/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, room, building }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.category) {
        return data as AIClassificationResult;
      }
    }
  } catch {
    // Silent fallback to local heuristic
  }

  return heuristicClassify(description, room, building);
}
