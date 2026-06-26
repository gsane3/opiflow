// Tasks — DB row + API DTO types (reference module). Mirrors /api/tasks.

export const TASK_COLUMNS = [
  'id', 'customer_id', 'offer_id', 'title', 'type', 'status', 'priority',
  'due_date', 'due_time', 'note', 'created_from_ai', 'completed_at',
  'created_at', 'updated_at',
].join(', ');

export interface TaskRow {
  id: string;
  customer_id: string | null;
  offer_id: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  due_date: string;
  due_time: string | null;
  note: string | null;
  created_from_ai: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  customerId: string | null;
  offerId: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  dueTime: string | null;
  note: string | null;
  createdFromAi: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
