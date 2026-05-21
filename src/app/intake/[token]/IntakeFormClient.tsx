'use client';

import { FormEvent, useEffect, useState } from 'react';

export interface IntakeCustomer {
  crmNumber: string | null;
  displayName: string;
  phoneMasked: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  needsSummary: string | null;
  intakeStatus: string;
}

interface IntakeApiResponse {
  ok: boolean;
  customer?: IntakeCustomer;
  error?: string;
}

interface IntakeFormClientProps {
  token: string;
  initialCustomer?: IntakeCustomer | null;
  initialError?: string | null;
}

export default function IntakeFormClient({
  token,
  initialCustomer = null,
  initialError = null,
}: IntakeFormClientProps) {
  const [customer, setCustomer] = useState<IntakeCustomer | null>(initialCustomer);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialCustomer?.email ?? '');
  const [address, setAddress] = useState(initialCustomer?.address ?? '');
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(!initialCustomer && !initialError);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState(
    initialError ??
      (initialCustomer
        ? 'Συμπληρώστε τα στοιχεία σας για να ολοκληρώσουμε την καρτέλα.'
        : 'Φορτώνουμε τη φόρμα...')
  );

  useEffect(() => {
    if (initialCustomer || initialError) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setMessage('Φορτώνουμε τη φόρμα...');

      try {
        const response = await fetch(`/api/intake/${encodeURIComponent(token)}`);
        const json = (await response.json()) as IntakeApiResponse;

        if (cancelled) return;

        if (!response.ok || !json.ok || !json.customer) {
          setCustomer(null);
          setMessage('Ο σύνδεσμος δεν είναι διαθέσιμος ή έχει λήξει.');
          return;
        }

        setCustomer(json.customer);
        setEmail(json.customer.email ?? '');
        setAddress(json.customer.address ?? '');
        setMessage('Συμπληρώστε τα στοιχεία σας για να ολοκληρώσουμε την καρτέλα.');
      } catch {
        if (!cancelled) {
          setCustomer(null);
          setMessage('Δεν μπορέσαμε να φορτώσουμε τη φόρμα. Δοκιμάστε ξανά.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [token, initialCustomer, initialError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firstName.trim() && !lastName.trim()) {
      setMessage('Συμπληρώστε όνομα ή επώνυμο.');
      return;
    }

    setSaving(true);
    setMessage('Αποθηκεύουμε τα στοιχεία...');

    try {
      const response = await fetch(`/api/intake/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          address,
          comments,
        }),
      });

      const json = (await response.json()) as IntakeApiResponse;

      if (!response.ok || !json.ok || !json.customer) {
        setMessage('Δεν μπορέσαμε να αποθηκεύσουμε τα στοιχεία. Δοκιμάστε ξανά.');
        return;
      }

      setCustomer(json.customer);
      setSubmitted(true);
      setMessage('Ευχαριστούμε. Τα στοιχεία σας καταχωρήθηκαν.');
    } catch {
      setMessage('Δεν μπορέσαμε να αποθηκεύσουμε τα στοιχεία. Δοκιμάστε ξανά.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8">
      <div className="mx-auto max-w-lg">
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Yorgos CRM
          </p>
          <h1 className="mt-2 text-2xl font-bold text-zinc-900">
            Συμπλήρωση στοιχείων
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Μετά την τηλεφωνική επικοινωνία, συμπληρώστε τα βασικά στοιχεία σας για να συνεχίσουμε σωστά.
          </p>

          <div className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
            {loading ? (
              <p>Φόρτωση...</p>
            ) : customer ? (
              <div className="space-y-1">
                <p>
                  <span className="font-semibold text-zinc-800">Καρτέλα:</span>{' '}
                  {customer.crmNumber ?? 'Νέα καρτέλα'}
                </p>
                {customer.phoneMasked ? (
                  <p>
                    <span className="font-semibold text-zinc-800">Τηλέφωνο:</span>{' '}
                    {customer.phoneMasked}
                  </p>
                ) : null}
              </div>
            ) : (
              <p>Δεν βρέθηκε ενεργή φόρμα.</p>
            )}
          </div>

          <p className="mt-4 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            {message}
          </p>

          {customer && !submitted ? (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Όνομα</span>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-indigo-400"
                    placeholder="π.χ. Γιώργος"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Επώνυμο</span>
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-indigo-400"
                    placeholder="π.χ. Παπαδόπουλος"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-indigo-400"
                  placeholder="name@example.com"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Διεύθυνση</span>
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-indigo-400"
                  placeholder="Οδός, αριθμός, περιοχή"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Σχόλια</span>
                <textarea
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  className="mt-1 min-h-28 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-indigo-400"
                  placeholder="Οτιδήποτε θέλετε να μας ενημερώσετε."
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Αποθήκευση...' : 'Αποστολή στοιχείων'}
              </button>
            </form>
          ) : null}

          {submitted ? (
            <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
              Η καρτέλα σας ενημερώθηκε. Ευχαριστούμε.
            </div>
          ) : null}
        </section>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Τα στοιχεία χρησιμοποιούνται μόνο για την εξυπηρέτησή σας.
        </p>
      </div>
    </main>
  );
}
