import { supabase } from './supabase';

// Calls the same backend as the web app (Vercel-hosted Next.js API routes) with
// the Supabase JWT. Override the base via EXPO_PUBLIC_API_URL if needed.
const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://www.opiflow.ai').replace(/\/$/, '');

// Basements/elevators: without a timeout a dead network leaves spinners hanging
// for 60+ seconds. Abort early and let screens show their retry UI.
const TIMEOUT_MS = 12_000;

/**
 * Thrown for ANY non-2xx response, network failure, or timeout. Screens catch
 * this (they already wrap loads in try/catch) instead of silently rendering an
 * empty object as data — the old behaviour turned every 401/500 into fake
 * "empty CRM" screens and false «αποθηκεύτηκε ✓» confirmations.
 */
export class ApiError extends Error {
  /** HTTP status; 0 = network failure or timeout (no response). */
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** Offline / timeout — show «έλεγξε τη σύνδεση», not «κάτι πήγε στραβά». */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export interface RequestOpts {
  /** Override the default 12s timeout for this one call (e.g. large audio uploads). */
  timeoutMs?: number;
}

async function request<T>(path: string, init?: RequestInit, opts?: RequestOpts): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, null, 'Πρόβλημα σύνδεσης');
  } finally {
    clearTimeout(timer);
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401) {
      // The server rejected our JWT — the session is truly dead (authHeaders
      // already let supabase-js try a refresh). Sign out so the Gate returns
      // the user to login instead of an empty-looking CRM.
      void supabase.auth.signOut().catch(() => {});
    }
    const apiErr = (body as { error?: string } | null)?.error;
    throw new ApiError(res.status, body, apiErr ?? `API ${res.status}`);
  }

  return body as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T = unknown>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) }, opts);
}

export function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiPut<T = unknown>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) }, opts);
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
