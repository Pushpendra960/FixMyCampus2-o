export type IssueCategory =
  | 'IT / Audio-Visual Support'
  | 'IT/AV Support'
  | 'Classroom Supplies'
  | 'Facilities / Maintenance'
  | 'Facilities/Maintenance'
  | 'Electrical Maintenance'
  | 'Electrical'
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
  photoUrl?: string;
  reportedAt: string;
  assignedTo?: string;
  assignedDepartmentCoordinator?: string;
  assignedDepartmentHead?: string;
  timeline: TicketTimelineEvent[];
  resolution?: ResolutionEvidence;
  isDuplicateOf?: string;
  upvotes?: number;
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
}

export interface AIClassificationResult {
  category: IssueCategory;
  recommendedDepartment: string;
  priority: TicketPriority;
  aiSummary: string;
  urgencyReason: string;
  suggestedAction: string;
}
