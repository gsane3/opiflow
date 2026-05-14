import type { YorgosMvpState, Customer, Task, Offer } from './types';

const STORAGE_KEY = 'yorgos_ai_mvp_state';

export function loadState(): YorgosMvpState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as YorgosMvpState) : {};
  } catch {
    return {};
  }
}

export function saveState(partial: Partial<YorgosMvpState>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
  } catch {
    // localStorage unavailable
  }
}

export function clearState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getCustomers(): Customer[] {
  return loadState().customers ?? [];
}

export function saveCustomers(customers: Customer[]): void {
  saveState({ customers });
}

export function addCustomer(customer: Customer): void {
  saveCustomers([...getCustomers(), customer]);
}

export function updateCustomer(updated: Customer): void {
  saveCustomers(getCustomers().map((c) => (c.id === updated.id ? updated : c)));
}

export function deleteCustomer(id: string): void {
  saveCustomers(getCustomers().filter((c) => c.id !== id));
}

export function getTasks(): Task[] {
  return loadState().tasks ?? [];
}

export function saveTasks(tasks: Task[]): void {
  saveState({ tasks });
}

export function addTask(task: Task): void {
  saveTasks([...getTasks(), task]);
}

export function updateTask(updated: Task): void {
  saveTasks(getTasks().map((t) => (t.id === updated.id ? updated : t)));
}

export function deleteTask(id: string): void {
  saveTasks(getTasks().filter((t) => t.id !== id));
}

export function getOffers(): Offer[] {
  return loadState().offers ?? [];
}

export function saveOffers(offers: Offer[]): void {
  saveState({ offers });
}

export function addOffer(offer: Offer): void {
  saveOffers([...getOffers(), offer]);
}

export function updateOffer(updated: Offer): void {
  saveOffers(getOffers().map((o) => (o.id === updated.id ? updated : o)));
}

export function deleteOffer(id: string): void {
  saveOffers(getOffers().filter((o) => o.id !== id));
}
