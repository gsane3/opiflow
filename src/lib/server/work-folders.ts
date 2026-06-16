// Shared types, validation, and mapping for the Φάκελος εργασίας (work folder)
// business APIs (WF-1A). PURE helpers only — no DB access — so they are unit-
// testable and reused across the folders / folders-[id] / attach routes.
//
// DB enum values stay English (open/in_progress/done/archived), consistent with
// the rest of the schema. Greek labels («Νέο» / «Σε εξέλιξη» / «Ολοκληρώθηκε» /
// «Αρχειοθετήθηκε») are a UI concern and live in the client, added in WF-1B.

export const FOLDER_STATUSES = ['open', 'in_progress', 'done', 'archived'] as const;
export type FolderStatus = (typeof FOLDER_STATUSES)[number];

export const MAX_FOLDER_TITLE = 120;

export function isFolderStatus(value: unknown): value is FolderStatus {
  return typeof value === 'string' && (FOLDER_STATUSES as readonly string[]).includes(value);
}

/** Trim + validate a folder title. Returns the cleaned value or an error code. */
export function validateFolderTitle(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: 'title_required' | 'title_too_long' } {
  if (typeof value !== 'string') return { ok: false, error: 'title_required' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: 'title_required' };
  if (trimmed.length > MAX_FOLDER_TITLE) return { ok: false, error: 'title_too_long' };
  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// Row type + mapper
// ---------------------------------------------------------------------------

export interface WorkFolderRow {
  id: string;
  business_id: string;
  customer_id: string;
  title: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderCounts {
  offers: number;
  appointments: number;
  messages: number;
  uploadRequests: number;
  intakeRequests: number;
}

export interface WorkFolder {
  id: string;
  businessId: string;
  customerId: string;
  title: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  counts?: FolderCounts;
}

export function emptyFolderCounts(): FolderCounts {
  return { offers: 0, appointments: 0, messages: 0, uploadRequests: 0, intakeRequests: 0 };
}

export function dbToFolder(row: WorkFolderRow, counts?: FolderCounts): WorkFolder {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    title: row.title,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(counts ? { counts } : {}),
  };
}

// ---------------------------------------------------------------------------
// Ordering: active (open/in_progress) before inactive (done/archived); newest
// first within the same rank. Pure so the ordering is unit-testable.
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<string, number> = { open: 0, in_progress: 1, done: 2, archived: 3 };

export function folderStatusRank(status: string): number {
  return STATUS_RANK[status] ?? 99;
}

export function orderFolders<T extends { status: string; createdAt: string }>(folders: T[]): T[] {
  return [...folders].sort(
    (a, b) => folderStatusRank(a.status) - folderStatusRank(b.status) || b.createdAt.localeCompare(a.createdAt),
  );
}

// ---------------------------------------------------------------------------
// Attachable entities → DB table. All five carry a customer_id that the attach
// route cross-checks against the folder's customer (defense in depth — we never
// rely on the DB FK alone for tenant/customer isolation).
// ---------------------------------------------------------------------------

export const ATTACHABLE_ENTITIES = {
  offer: 'offers',
  task: 'tasks',
  communication: 'communications',
  intake_token: 'customer_intake_tokens',
  upload_token: 'customer_upload_tokens',
} as const;

export type AttachableEntityType = keyof typeof ATTACHABLE_ENTITIES;

export function isAttachableEntityType(value: unknown): value is AttachableEntityType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ATTACHABLE_ENTITIES, value);
}

// Appointment-type tasks (for the folder's "appointments" count / agenda).
export const APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;
