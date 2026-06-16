// Shared types, validation, and mapping for the Έργο (work folder)
// business APIs (WF-1A). PURE helpers only — no DB access — so they are unit-
// testable and reused across the folders / folders-[id] / attach routes.
//
// DB enum values stay English (open/in_progress/done/archived), consistent with
// the rest of the schema. Greek labels («Νέο» / «Σε εξέλιξη» / «Ολοκληρώθηκε» /
// «Αρχειοθετήθηκε») are a UI concern and live in the client, added in WF-1B.

export const FOLDER_STATUSES = ['open', 'in_progress', 'done', 'archived'] as const;
export type FolderStatus = (typeof FOLDER_STATUSES)[number];

export const MAX_FOLDER_TITLE = 120;

// The 5-step process every Έργο (work folder) moves through. The index is the
// `work_folders.step` smallint (0..4), shared by the technician timeline, the
// profile cards and the public portal so all three render the same Stepper.
export const WORK_FOLDER_STEPS = ['Επαφή', 'Προσφορά', 'Πληρωμή', 'Ραντεβού', 'Τέλος'] as const;
export const MAX_FOLDER_STEP = WORK_FOLDER_STEPS.length - 1; // 4

export function isFolderStatus(value: unknown): value is FolderStatus {
  return typeof value === 'string' && (FOLDER_STATUSES as readonly string[]).includes(value);
}

/** Terminal (finished) folder statuses. The customer portal link stops rolling
 *  its inactivity window and begins its post-completion countdown once a folder
 *  reaches one of these — `done` (completed) or `archived`. */
export function isTerminalFolderStatus(value: unknown): boolean {
  return value === 'done' || value === 'archived';
}

/** Coerce any DB/legacy value into a valid step (0..MAX). Tolerant of a missing
 *  column (pre-migration-047 rows) → defaults to 0. */
export function clampStep(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i < 0 ? 0 : i > MAX_FOLDER_STEP ? MAX_FOLDER_STEP : i;
}

/** Validate a client-supplied step. Must be an integer in 0..MAX. */
export function validateFolderStep(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: 'invalid_step' } {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_FOLDER_STEP) {
    return { ok: false, error: 'invalid_step' };
  }
  return { ok: true, value };
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
  // step is optional at the type level so reads stay safe before migration 047
  // is applied (the column is absent → undefined → clampStep() yields 0).
  step?: number | null;
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
  step: number;
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
    step: clampStep(row.step),
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
