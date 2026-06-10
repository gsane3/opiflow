import { supabase } from './supabase';

// Calls the same backend as the web app (Vercel-hosted Next.js API routes) with
// the Supabase JWT. Override the base via EXPO_PUBLIC_API_URL if needed.
const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://www.opiflow.ai').replace(/\/$/, '');

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(await authHeaders()), ...(init?.headers ?? {}) } });
  return (await res.json().catch(() => ({}))) as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
