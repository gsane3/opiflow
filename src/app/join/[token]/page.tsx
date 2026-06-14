'use client';

// /join/<token> — a teammate opens the invite link here. If logged in, we accept
// the invite (creating their membership) and send them into the app. If not, we
// point them to log in / register with the invited email first.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type State = 'checking' | 'need_login' | 'accepting' | 'ok' | 'wrong' | 'expired' | 'invalid' | 'error';

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params?.token ?? '');
  const [state, setState] = useState<State>('checking');
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) { setState('need_login'); return; }
        setState('accepting');
        const res = await fetch('/api/team/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ token }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json?.ok) {
          setState('ok');
          setTimeout(() => router.replace('/customers'), 1300);
        } else if (json?.error === 'wrong_account') {
          setInvitedEmail(json.invitedEmail ?? null);
          setState('wrong');
        } else if (json?.error === 'invite_expired') {
          setState('expired');
        } else if (json?.error === 'invite_invalid') {
          setState('invalid');
        } else {
          setState('error');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, router]);

  const next = `/join/${encodeURIComponent(token)}`;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#F5F5F7] dark:bg-[#0e1722] px-6 text-center">
      <div className="w-full max-w-sm rounded-[28px] bg-white dark:bg-[#17232f] p-6 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <p className="text-2xl">👋</p>
        <h1 className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">Πρόσκληση στην ομάδα Opiflow</h1>

        {state === 'checking' || state === 'accepting' ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Έλεγχος πρόσκλησης…</p>
        ) : state === 'ok' ? (
          <p className="mt-3 text-sm text-emerald-700">Μπήκες στην ομάδα! 🎉 Μεταφορά στην εφαρμογή…</p>
        ) : state === 'need_login' ? (
          <>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Συνδέσου ή κάνε εγγραφή <b>με το email στο οποίο έλαβες την πρόσκληση</b> και μετά άνοιξε ξανά αυτόν τον σύνδεσμο.</p>
            <div className="mt-4 flex flex-col gap-2">
              <Link href={`/login?next=${encodeURIComponent(next)}`} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Σύνδεση</Link>
              <Link href={`/register?next=${encodeURIComponent(next)}`} className="rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5">Εγγραφή</Link>
            </div>
          </>
        ) : state === 'wrong' ? (
          <p className="mt-3 text-sm text-amber-600">Αυτή η πρόσκληση είναι για {invitedEmail ? <b>{invitedEmail}</b> : 'άλλο email'}. Συνδέσου με αυτό το email και ξαναδοκίμασε.</p>
        ) : state === 'expired' ? (
          <p className="mt-3 text-sm text-amber-600">Η πρόσκληση έληξε. Ζήτησε νέα από τον ιδιοκτήτη.</p>
        ) : state === 'invalid' ? (
          <p className="mt-3 text-sm text-amber-600">Ο σύνδεσμος δεν είναι έγκυρος ή ακυρώθηκε.</p>
        ) : (
          <p className="mt-3 text-sm text-red-600">Κάτι πήγε στραβά. Δοκίμασε ξανά τον σύνδεσμο.</p>
        )}
      </div>
    </div>
  );
}
