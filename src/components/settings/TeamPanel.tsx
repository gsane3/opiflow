'use client';

// Settings → Ομάδα: list members, invite teammates (owner/admin), revoke invites,
// remove members. The owner copies the generated join link and sends it to the
// teammate. Hidden gracefully if the team tables aren't available yet.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface Member {
  userId: string;
  email: string | null;
  role: string;
  isYou: boolean;
}
interface Invite {
  id: string;
  email: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = { owner: 'Ιδιοκτήτης', admin: 'Διαχειριστής', member: 'Μέλος' };

async function token(): Promise<string | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

export default function TeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [yourRole, setYourRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canManage = yourRole === 'owner' || yourRole === 'admin';

  const load = useCallback(async () => {
    const t = await token();
    if (!t) { setLoading(false); return; }
    const headers = { Authorization: `Bearer ${t}` };
    try {
      const mRes = await fetch('/api/team/members', { headers });
      const m = await mRes.json().catch(() => ({}));
      if (m?.ok) {
        setMembers(m.members ?? []);
        setYourRole(m.yourRole ?? 'member');
        if (m.yourRole === 'owner' || m.yourRole === 'admin') {
          const iRes = await fetch('/api/team/invites', { headers });
          const i = await iRes.json().catch(() => ({}));
          if (i?.ok) setInvites(i.invites ?? []);
        }
      }
    } catch {
      /* keep empty */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const invite = useCallback(async () => {
    setMsg(null);
    setJoinUrl(null);
    setCopied(false);
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setMsg('Μη έγκυρο email.'); return; }
    setBusy(true);
    try {
      const t = await token();
      if (!t) { setMsg('Πρέπει να συνδεθείς ξανά.'); return; }
      const res = await fetch('/api/team/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ email: e, role }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.joinUrl) {
        setJoinUrl(json.joinUrl);
        setEmail('');
        void load();
      } else {
        setMsg('Η πρόσκληση απέτυχε. Δοκίμασε ξανά.');
      }
    } catch {
      setMsg('Η πρόσκληση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }, [email, role, load]);

  const revoke = useCallback(async (id: string) => {
    const t = await token();
    if (!t) return;
    await fetch('/api/team/invites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    void load();
  }, [load]);

  const removeMember = useCallback(async (userId: string) => {
    const t = await token();
    if (!t) return;
    await fetch('/api/team/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
    void load();
  }, [load]);

  async function copyLink() {
    if (!joinUrl) return;
    try { await navigator.clipboard.writeText(joinUrl); setCopied(true); } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="mt-4 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ομάδα</p>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">Φόρτωση…</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ομάδα</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Πρόσθεσε τεχνικούς που θα μοιράζονται την ίδια επιχείρηση.</p>

      {/* Members */}
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-white/10">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-800 dark:text-zinc-200">{m.email ?? m.userId.slice(0, 8)}{m.isYou && ' (εσύ)'}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{ROLE_LABEL[m.role] ?? m.role}</p>
            </div>
            {canManage && !m.isYou && m.role !== 'owner' && (
              <button type="button" onClick={() => removeMember(m.userId)} className="shrink-0 text-[11px] font-medium text-red-600 hover:text-red-700">
                Αφαίρεση
              </button>
            )}
          </li>
        ))}
      </ul>

      {!canManage && (
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">Μόνο ο ιδιοκτήτης/διαχειριστής μπορεί να προσκαλεί μέλη.</p>
      )}

      {canManage && (
        <>
          {/* Pending invites */}
          {invites.length > 0 && (
            <div className="mt-3 border-t border-zinc-100 dark:border-white/10 pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Εκκρεμείς προσκλήσεις</p>
              <ul className="mt-1.5 space-y-1.5">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-zinc-600 dark:text-zinc-300">{i.email} · {ROLE_LABEL[i.role] ?? i.role}</span>
                    <button type="button" onClick={() => revoke(i.id)} className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-red-600">Ακύρωση</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Invite form */}
          <div className="mt-3 border-t border-zinc-100 dark:border-white/10 pt-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                placeholder="email@τεχνικού.gr"
                className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-100 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
                className="rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-100 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              >
                <option value="member">Μέλος</option>
                <option value="admin">Διαχειριστής</option>
              </select>
              <button
                type="button"
                onClick={invite}
                disabled={busy}
                className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? '…' : 'Πρόσκληση'}
              </button>
            </div>
            {msg && <p className="mt-2 text-xs text-amber-600">{msg}</p>}
            {joinUrl && (
              <div className="mt-2 rounded-xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
                <p className="text-xs font-medium text-indigo-900">Στείλε αυτόν τον σύνδεσμο στον τεχνικό:</p>
                <p className="mt-1 break-all rounded-lg bg-white dark:bg-[#0f1923] px-2 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-white/10">{joinUrl}</p>
                <button type="button" onClick={copyLink} className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700">
                  {copied ? 'Αντιγράφηκε ✓' : 'Αντιγραφή συνδέσμου'}
                </button>
                <p className="mt-1.5 text-[10px] text-indigo-700/70">Ο τεχνικός πρέπει να εγγραφεί/συνδεθεί με <b>αυτό ακριβώς το email</b> για να μπει στην ομάδα.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
