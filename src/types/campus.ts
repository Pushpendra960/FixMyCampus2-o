export type IssueCategory =
  | 'IT / Audio-Visual Support'
  | 'IT/AV Support'
  | 'Classroom Supplies'
  | 'Facilities / Maintenance'
  | 'Facilities/Maintenance'
  | 'Electrical Maintenance'
  | 'Electrical'
  | 'Plumbing / Maintenance'
  | 'Plumbing'
  | 'Housekeeping'
  | 'General Administration'
  | 'Other';

export type TicketPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export type TicketStatus =
  | 'Open'
  | 'Assigned'
  | 'In Progress'
  | 'Pending Verification'
  | 'Resolved'
  | 'Closed'
  | 'Needs Review';

export const SLA_TARGET_HOURS = 4;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB raw upload limit before compression

export const VALID_TICKET_STATUSES: TicketStatus[] = [
  'Open',
  'Assigned',
  'In Progress',
  'Pending Verification',
  'Resolved',
  'Closed',
  'Needs Review',
];

/**
 * Allowed next status transitions per lifecycle stage.
 * Prevents skipping directly from Open/Needs Review to Closed without resolution/verification.
 */
export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  'Needs Review': ['Needs Review', 'Open', 'Assigned', 'In Progress'],
  Open: ['Open', 'Assigned', 'In Progress', 'Pending Verification', 'Resolved', 'Needs Review'],
  Assigned: ['Assigned', 'In Progress', 'Pending Verification', 'Resolved', 'Open'],
  'In Progress': ['In Progress', 'Pending Verification', 'Resolved', 'Assigned'],
  'Pending Verification': ['Pending Verification', 'Resolved', 'Closed', 'In Progress'],
  Resolved: ['Resolved', 'Closed', 'In Progress'],
  Closed: ['Closed'],
};

export interface TechnicianProfile {
  name: string;
  role: string;
  departments: string[];
}

export const TECHNICIAN_ROSTER: TechnicianProfile[] = [
  {
    name: 'Leo Ramirez (Senior AV Tech)',
    role: 'Audio-Visual & Classroom IT',
    departments: ['IT / Audio-Visual Support', 'IT/AV Support', 'IT & Multimedia Services'],
  },
  {
    name: 'Marcus Vance (Facilities Lead)',
    role: 'Furniture, Doors & Physical Plant',
    departments: ['Facilities / Maintenance', 'Facilities/Maintenance', 'Facilities & Physical Plant'],
  },
  {
    name: 'Derrick Powell (HVAC Specialist)',
    role: 'HVAC, AC & Building Systems',
    departments: ['Facilities / Maintenance', 'Facilities/Maintenance', 'Facilities & Physical Plant'],
  },
  {
    name: 'Kofi Mensah (Lead Electrician)',
    role: 'Wiring, Breakers & Luminaires',
    departments: ['Electrical Maintenance', 'Electrical', 'Electrical Infrastructure'],
  },
  {
    name: 'Carlos Mendez (Master Plumber)',
    role: 'Plumbing, Pipes, Faucets & Drains',
    departments: ['Plumbing / Maintenance', 'Plumbing', 'Facilities / Maintenance', 'Plumbing & Sanitation'],
  },
  {
    name: 'Elena Rostova (Supplies Coordinator)',
    role: 'Markers, Erasers & Classroom Kit',
    departments: ['Classroom Supplies', 'Academic Resource & Supplies'],
  },
  {
    name: 'Amina Diallo (Custodial Inspector)',
    role: 'Sanitation, Spills & Washroom Upkeep',
    departments: ['Housekeeping', 'Custodial & Housekeeping'],
  },
];

export interface TicketTimelineEvent {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  notes?: string;
}

export interface ResolutionEvidence {
  resolvedAt: string;
  resolvedBy: string;
  notes: string;
  photoUrl?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface TicketEvidenceRecord {
  evidenceId: string;
  ticketId: string;
  evidenceType: string;
  evidenceReference: string;
  notes: string;
  submittedAt: string;
  submittedBy: string;
}

export interface CampusTicket {
  id: string; // e.g. FMC-1001
  facultyName: string;
  isAnonymous: boolean;
  facultyEmail?: string;
  building: string;
  roomNumber: string;
  description: string;
  category: IssueCategory;
  recommendedDepartment: string;
  priority: TicketPriority;
  status: TicketStatus;
  aiSummary: string;
  urgencyReason: string;
  suggestedAction?: string;
  classificationSource?: 'gemini' | 'heuristic-fallback';
  routingNote?: string;
  photoUrl?: string;
  reportedAt: string;
  updatedAt?: string;
  closedAt?: string;
  assignedTo?: string;
  assignedDepartmentCoordinator?: string;
  assignedDepartmentHead?: string;
  timeline: TicketTimelineEvent[];
  resolution?: ResolutionEvidence;
  evidenceRecords?: TicketEvidenceRecord[];
  isDuplicateOf?: string;
  upvotes?: number;
  notifyReporter?: boolean;
}

export interface DepartmentDirectoryRow {
  Department?: string;
  Keywords?: string;
  ResponsibleName?: string;
  ResponsibleEmail?: string;
  DepartmentHeadEmail?: string;
  Active?: boolean | string;
  EmailConfigStatus?: 'Configured' | 'Missing Head CC' | 'Missing Responsible Email' | 'Inactive';
  ResponsibleEmailValid?: boolean;
  DepartmentHeadEmailValid?: boolean;
  IsActive?: boolean;
  [key: string]: any;
}

export interface DepartmentDirectorySummary {
  totalDepartments: number;
  activeDepartments: number;
  configuredDepartments: number;
  missingResponsibleCount: number;
  missingResponsibleEmail: string[];
  missingHeadCount: number;
  missingHeadEmail: string[];
}

export interface RoomRecord {
  roomNumber: string;
  building: string;
  roomType: 'Lecture Hall' | 'Computer Lab' | 'Seminar Room' | 'Science Lab' | 'Faculty Office';
  capacity: number;
  equipment: string[];
  totalIncidents: number;
  activeTickets: string[];
  lastMaintenance: string;
}

export interface DepartmentInfo {
  name: string;
  headName: string;
  headEmail: string;
  leadCoordinator: string;
  coordinatorEmail: string;
  categories: IssueCategory[];
  avgResolutionHours: number;
}

export interface SimulatedNotification {
  id: string;
  ticketId: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: 'Department Head' | 'Coordinator' | 'Assigned Technician' | 'Faculty Reporter';
  channel: 'Email (Simulated)' | 'SMS/Alert (Simulated)';
  subject: string;
  body: string;
  timestamp: string;
  status: 'Queued' | 'Dispatched (Demo)';
  isRead?: boolean;
}

export type BackendConnectionStatus = 'demo' | 'connecting' | 'live' | 'error';

export interface AIClassificationResult {
  category: IssueCategory;
  recommendedDepartment: string;
  priority: TicketPriority;
  aiSummary: string;
  urgencyReason: string;
  suggestedAction: string;
  classificationSource?: 'gemini' | 'heuristic-fallback';
  usedFallback?: boolean;
  fallbackReason?: string;
  uncertainRouting?: boolean;
  routingNote?: string;
  model?: string;
}
