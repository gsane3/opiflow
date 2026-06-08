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

type PreferredContactMethod = 'viber' | 'whatsapp' | 'sms' | 'email';

const CONTACT_METHOD_OPTIONS: { value: PreferredContactMethod; label: string }[] = [
  { value: 'viber', label: 'Viber' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
];

interface IntakeFormClientProps {
  token: string;
  initialCustomer?: IntakeCustomer | null;
  initialError?: string | null;
  initialSubmitted?: boolean;
}

export default function IntakeFormClient({
  token,
  initialCustomer = null,
  initialError = null,
  initialSubmitted = false,
}: IntakeFormClientProps) {
  const [customer, setCustomer] = useState<IntakeCustomer | null>(initialCustomer);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialCustomer?.email ?? '');
  const [address, setAddress] = useState(initialCustomer?.address ?? '');
  const [comments, setComments] = useState('');
  const [preferredContactMethod, setPreferredContactMethod] =
    useState<PreferredContactMethod>('viber');
  const [loading, setLoading] = useState(!initialSubmitted && !initialCustomer && !initialError);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [message, setMessage] = useState(
    initialSubmitted
      ? 'Τα στοιχεία σας στάλθηκαν. Η επιχείρηση θα ενημερωθεί.'
      : initialError ??
          (initialCustomer
            ? 'Συμπληρώστε τα στοιχεία σας για να ολοκληρώσουμε την καρτέλα.'
            : 'Φορτώνουμε τη φόρμα...')
  );

  useEffect(() => {
    if (initialSubmitted || initialCustomer || initialError) return;

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
          setMessage('Το link δεν είναι πλέον ενεργό. Επικοινωνήστε με την επιχείρηση.');
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
  }, [token, initialSubmitted, initialCustomer, initialError]);

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
          preferredContactMethod,
        }),
      });

      const json = (await response.json()) as IntakeApiResponse;

      if (!response.ok || !json.ok || !json.customer) {
        setMessage('Δεν μπορέσαμε να αποθηκεύσουμε τα στοιχεία. Δοκιμάστε ξανά.');
        return;
      }

      setCustomer(json.customer);
      setSubmitted(true);
      setMessage('Τα στοιχεία σας στάλθηκαν. Η επιχείρηση θα ενημερωθεί.');
    } catch {
      setMessage('Δεν μπορέσαμε να αποθηκεύσουμε τα στοιχεία. Δοκιμάστε ξανά.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <header className="px-1 text-center">
          <h1 className="text-2xl font-bold text-[#0B1120]">
            Συμπλήρωση στοιχείων
          </h1>
          <p className="mt-2 text-base leading-7 text-zinc-600">
            Συμπληρώστε τα βασικά στοιχεία σας για να σας εξυπηρετήσουμε σωστά.
          </p>
        </header>

        <section className="mt-6 rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-zinc-200/60">
          {customer ? (
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
              <p>
                <span className="font-semibold text-zinc-900">Καρτέλα:</span>{' '}
                {customer.crmNumber ?? 'Νέα καρτέλα'}
              </p>
              {customer.phoneMasked ? (
                <p className="mt-1">
                  <span className="font-semibold text-zinc-900">Τηλέφωνο:</span>{' '}
                  {customer.phoneMasked}
                </p>
              ) : null}
            </div>
          ) : loading ? (
            <p className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">Φόρτωση...</p>
          ) : null}

          {message ? (
            <p className="mt-4 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              {message}
            </p>
          ) : null}

          {customer && !submitted ? (
            <form action={`/api/intake/${encodeURIComponent(token)}`} method="post" onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Όνομα</span>
                  <input
                    name="firstName"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    className="mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base outline-none focus:border-indigo-400"
                    placeholder="π.χ. Γιώργος"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Επώνυμο</span>
                  <input
                    name="lastName"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    className="mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base outline-none focus:border-indigo-400"
                    placeholder="π.χ. Παπαδόπουλος"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Email</span>
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  className="mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base outline-none focus:border-indigo-400"
                  placeholder="name@example.com"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Διεύθυνση</span>
                <input
                  name="address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  autoComplete="street-address"
                  className="mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base outline-none focus:border-indigo-400"
                  placeholder="Οδός, αριθμός, περιοχή"
                />
              </label>

              <fieldset className="block">
                <legend className="text-sm font-medium text-zinc-700">
                  Πώς προτιμάς να επικοινωνούμε;
                </legend>
                <input type="hidden" name="preferredContactMethod" value={preferredContactMethod} />
                <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
                  {CONTACT_METHOD_OPTIONS.map((option) => {
                    const selected = preferredContactMethod === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setPreferredContactMethod(option.value)}
                        className={`flex min-h-[44px] items-center justify-center rounded-xl border px-4 text-base font-medium transition ${
                          selected
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-indigo-400'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Σχόλια</span>
                <textarea
                  name="comments"
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  className="mt-1 min-h-28 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none focus:border-indigo-400"
                  placeholder="Οτιδήποτε θέλετε να μας ενημερώσετε."
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="h-12 w-full rounded-xl bg-indigo-600 px-5 text-base font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Αποθήκευση...' : 'Αποστολή στοιχείων'}
              </button>
            </form>
          ) : null}

          {submitted ? (
            <div className="mt-5 rounded-2xl bg-green-50 p-4 text-center text-sm font-medium text-green-700">
              Τα στοιχεία σας στάλθηκαν. Η επιχείρηση θα ενημερωθεί.
            </div>
          ) : null}

          <p className="mt-6 text-center text-sm text-zinc-500">
            Τα στοιχεία χρησιμοποιούνται μόνο για την εξυπηρέτησή σας.
          </p>
        </section>
      </div>
    </main>
  );
}
