'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { RequireAdmin } from '@/components/admin/RequireAdmin';

type PageState = 'loading' | 'no_config' | 'no_session' | 'loading_business' | 'no_business' | 'ready' | 'error';

interface Business {
  id: string;
  name: string;
  type: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
  tax_office: string | null;
  default_vat_rate: number | null;
  preferred_contact_method: string | null;
}

const EMPTY = 'Δεν έχει συμπληρωθεί';

const TYPE_LABELS: Record<string, string> = {
  technical_services: 'Τεχνικές υπηρεσίες',
  sales_services: 'Πωλήσεις / υπηρεσίες',
  projects_construction: 'Έργα / κατασκευές',
  other: 'Άλλο',
};

const CONTACT_LABELS: Record<string, string> = {
  phone: 'Τηλέφωνο',
  email: 'Email',
  viber: 'Viber',
};

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-zinc-100 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-4 last:border-0">
      <dt className="text-xs font-medium text-zinc-500">{label}:</dt>
      <dd className="text-sm text-zinc-900 break-all">
        {value !== null && value !== undefined && value !== '' ? String(value) : EMPTY}
      </dd>
    </div>
  );
}

function BusinessBackendPageInner() {
  const [state, setState] = useState<PageState>('loading');
  const [business, setBusiness] = useState<Business | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        setState('no_config');
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data?.session;

      if (!session?.access_token) {
        setState('no_session');
        return;
      }

      setUserEmail(session.user?.email ?? null);
      setState('loading_business');

      let res: Response;
      try {
        res = await fetch('/api/businesses/me', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
      } catch {
        setState('error');
        return;
      }

      if (res.status === 200) {
        try {
          const json = await res.json();
          if (json?.business) {
            setBusiness(json.business as Business);
            setState('ready');
            return;
          }
        } catch {
          // fall through to error
        }
        setState('error');
        return;
      }

      if (res.status === 404) {
        setState('no_business');
        return;
      }

      setState('error');
    }

    load();
  }, []);

  async function handleLogout() {
    setLogoutLoading(true);
    setLogoutError(null);
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      setLogoutError('Δεν μπορέσαμε να κάνουμε αποσύνδεση. Δοκίμασε ξανά.');
      setLogoutLoading(false);
      return;
    }
    const { error: signOutError } = await supabase.auth.signOut();
    setLogoutLoading(false);
    if (signOutError) {
      setLogoutError('Δεν μπορέσαμε να κάνουμε αποσύνδεση. Δοκίμασε ξανά.');
      return;
    }
    setBusiness(null);
    setUserEmail(null);
    setState('no_session');
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Backend business test</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Αυτή η σελίδα διαβάζει την επιχείρηση από το backend με Supabase session. Δεν αντικαθιστά ακόμα τα MVP settings.
        </p>

        {state === 'loading' && (
          <p className="text-sm text-zinc-500">Έλεγχος backend session...</p>
        )}

        {state === 'loading_business' && (
          <p className="text-sm text-zinc-500">Φόρτωση επιχείρησης...</p>
        )}

        {state === 'no_config' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            Το backend auth δεν είναι ρυθμισμένο ακόμα.
          </div>
        )}

        {state === 'no_session' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm space-y-1">
            <p className="font-medium">Δεν υπάρχει ενεργό backend session.</p>
            <p>Συνδέσου πρώτα από τη backend login σελίδα.</p>
          </div>
        )}

        {state === 'no_business' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm space-y-1">
            <p className="font-medium">Δεν υπάρχει ακόμα επιχείρηση για αυτόν τον backend λογαριασμό.</p>
            <p>Πήγαινε στο backend onboarding test για να δημιουργήσεις μία.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            Δεν μπορέσαμε να φορτώσουμε την backend επιχείρηση.
          </div>
        )}

        {state === 'ready' && business && (
          <div>
            {userEmail && (
              <p className="text-xs text-zinc-500 mb-4">
                Συνδεδεμένος ως <span className="font-medium text-zinc-700">{userEmail}</span>
              </p>
            )}
            <h2 className="text-base font-semibold text-zinc-900 mb-3">Backend επιχείρηση</h2>
            <dl>
              <Field label="Όνομα" value={business.name} />
              <Field label="Τύπος" value={business.type ? (TYPE_LABELS[business.type] ?? business.type) : null} />
              <Field label="Τηλέφωνο" value={business.phone} />
              <Field label="Email" value={business.email} />
              <Field label="Διεύθυνση" value={business.address} />
              <Field label="ΑΦΜ" value={business.vat_number} />
              <Field label="ΔΟΥ" value={business.tax_office} />
              <Field label="ΦΠΑ %" value={business.default_vat_rate} />
              <Field label="Επαφή" value={business.preferred_contact_method ? (CONTACT_LABELS[business.preferred_contact_method] ?? business.preferred_contact_method) : null} />
              <Field label="ID" value={business.id} />
            </dl>
            {logoutError && (
              <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
                {logoutError}
              </div>
            )}
            <div className="mt-4">
              <button
                type="button"
                onClick={handleLogout}
                disabled={logoutLoading}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                {logoutLoading ? 'Αποσύνδεση...' : 'Αποσύνδεση'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-2 text-center text-sm">
          <p>
            <Link href="/onboarding/backend" className="text-indigo-600 hover:underline">
              Backend onboarding test
            </Link>
          </p>
          <p>
            <Link href="/login/backend" className="text-indigo-600 hover:underline">
              Backend login
            </Link>
          </p>
          <p>
            <Link href="/register" className="text-indigo-600 hover:underline">
              Δημιουργία backend λογαριασμού
            </Link>
          </p>
          <p>
            <Link href="/dashboard" className="text-zinc-500 hover:underline">
              Πίσω στο dashboard
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function BusinessBackendPage() {
  return (
    <RequireAdmin>
      <BusinessBackendPageInner />
    </RequireAdmin>
  );
}
