// Tasks — Zod input validation (reference module). Parity-matched to /api/tasks.

import { z } from 'zod';

export const TASK_TYPES = [
  'call_back', 'send_offer', 'follow_up_offer', 'ask_for_photos_documents',
  'book_appointment', 'visit_customer', 'wait_for_reply', 'other',
] as const;

/** Statuses readable via the GET filter (ai_draft included). */
export const TASK_STATUSES_READ = ['open', 'completed', 'cancelled', 'ai_draft'] as const;
/** Statuses allowed for manual write (ai_draft is system-only). */
export const TASK_STATUSES_WRITE = ['open', 'completed', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES_WRITE).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().regex(DATE_RE, 'invalid_due_date'),
  // '' is accepted and treated as null (parity with the route), else HH:MM.
  dueTime: z.string().refine((s) => s === '' || TIME_RE.test(s), 'invalid_due_time').optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  // Ownership (not format) is what's validated — kept a plain string like the route.
  customerId: z.string().min(1).optional(),
  offerId: z.string().min(1).optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const ListTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES_READ).optional(),
  customerId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
