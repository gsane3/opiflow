'use client';

import { FormEvent, useEffect, useState } from 'react';

export interface IntakeCustomer {
  crmNumber: string | null;
  displayName: string;
  phoneMasked: string | null;
  companyName: string | null;
  email: string | null;
  address: string | null;
  postalCode: string | null;
  region: string | null;
  notes: string | null;
  needsSummary: string | null;
  intakeStatus: string;
}

export interface IntakeBusiness {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface IntakeApiResponse {
  ok: boolean;
  customer?: IntakeCustomer;
  business?: IntakeBusiness | null;
  error?: string;
}

/** Build + download a .vcf so the customer can save the business as a contact —
 *  future calls from the business then show up branded on their phone. */
function downloadVCard(b: IntakeBusiness) {
  const esc = (s: string) => s.replace(/[,;\\]/g, (m) => `\\${m}`);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(b.name)}`, `ORG:${esc(b.name)}`];
  if (b.phone) lines.push(`TEL;TYPE=CELL:${b.phone}`);
  if (b.email) lines.push(`EMAIL:${b.email}`);
  if (b.website) lines.push(`URL:${b.website}`);
  lines.push('END:VCARD');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${b.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'contact'}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type PreferredContactMethod = 'viber' | 'sms' | 'email';

const CONTACT_METHOD_OPTIONS: { value: PreferredContactMethod; label: string }[] = [
  { value: 'viber', label: 'Viber' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
];

interface IntakeFormClientProps {
  token: string;
  initialCustomer?: IntakeCustomer | null;
  initialBusiness?: IntakeBusiness | null;
  initialError?: string | null;
  initialSubmitted?: boolean;
}

export default function IntakeFormClient({
  token,
  initialCustomer = null,
  initialBusiness = null,
  initialError = null,
  initialSubmitted = false,
}: IntakeFormClientProps) {
  const [customer, setCustomer] = useState<IntakeCustomer | null>(initialCustomer);
  const [business, setBusiness] = useState<IntakeBusiness | null>(initialBusiness);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState(initialCustomer?.companyName ?? '');
  const [email, setEmail] = useState(initialCustomer?.email ?? '');
  const [address, setAddress] = useState(initialCustomer?.address ?? '');
  const [postalCode, setPostalCode] = useState(initialCustomer?.postalCode ?? '');
  const [region, setRegion] = useState(initialCustomer?.region ?? '');
  const [needsSummary, setNeedsSummary] = useState(initialCustomer?.needsSummary ?? '');
  const [comments, setComments] = useState('');
  const [preferredContactMethod, setPreferredContactMethod] =
    useState<PreferredContactMethod>('viber');
  const [loading, setLoading] = useState(!initialSubmitted && !initialCustomer && !initialError);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  // Distinguishes a red error message from the neutral blue instruction.
  const [isError, setIsError] = useState(Boolean(initialError));
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
          setIsError(true);
          setMessage('Ο σύνδεσμος δεν είναι πλέον ενεργός. Επικοινωνήστε με την επιχείρηση.');
          return;
        }

        setCustomer(json.customer);
        if (json.business) setBusiness(json.business);
        setCompanyName(json.customer.companyName ?? '');
        setEmail(json.customer.email ?? '');
        setAddress(json.customer.address ?? '');
        setPostalCode(json.customer.postalCode ?? '');
        setRegion(json.customer.region ?? '');
        setNeedsSummary(json.customer.needsSummary ?? '');
        setIsError(false);
        setMessage('Συμπληρώστε τα στοιχεία σας για να ολοκληρώσουμε την καρτέλα.');
      } catch {
        if (!cancelled) {
          setCustomer(null);
          setIsError(true);
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
      setIsError(true);
      setMessage('Συμπληρώστε όνομα ή επώνυμο.');
      return;
    }

    setSaving(true);
    setIsError(false);
    setMessage('Αποθηκεύουμε τα στοιχεία...');

    try {
      const response = await fetch(`/api/intake/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          companyName,
          email,
          address,
          postalCode,
          region,
          needsSummary,
          comments,
          preferredContactMethod,
        }),
      });

      const json = (await response.json()) as IntakeApiResponse;

      if (!response.ok || !json.ok || !json.customer) {
        setIsError(true);
        setMessage('Δεν μπορέσαμε να αποθηκεύσουμε τα στοιχεία. Δοκιμάστε ξανά.');
        return;
      }

      setCustomer(json.customer);
      setSubmitted(true);
      setIsError(false);
      setMessage('Τα στοιχεία σας στάλθηκαν. Η επιχείρηση θα ενημερωθεί.');
    } catch {
      setIsError(true);
      setMessage('Δεν μπορέσαμε να αποθηκεύσουμε τα στοιχεία. Δοκιμάστε ξανά.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-[#0e1722] px-4 py-10">
      <div className="mx-auto max-w-lg">
        <header className="px-1 text-center">
          {business && (
            <div className="mb-4 flex flex-col items-center gap-2">
              {business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={business.logoUrl}
                  alt={business.name}
                  className="h-14 w-auto max-w-[12rem] object-contain"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white">
                  {business.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{business.name}</p>
            </div>
          )}
          <h1 className="text-2xl font-bold text-[#0B1120] dark:text-zinc-100">
            Συμπλήρωση στοιχείων
          </h1>
          <p className="mt-2 text-base leading-7 text-zinc-600 dark:text-zinc-300">
            {business
              ? `Συμπλήρωσε μερικά στοιχεία ώστε ${business.name} να σε εξυπηρετήσει σωστά.`
              : 'Συμπληρώστε τα βασικά στοιχεία σας για να σας εξυπηρετήσουμε σωστά.'}
          </p>
        </header>

        <section className="mt-6 rounded-[28px] bg-white dark:bg-[#17232f] p-6 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          {customer && !submitted ? (
            <div className="rounded-2xl bg-zinc-50 dark:bg-[#1e2b38] p-4 text-sm text-zinc-700 dark:text-zinc-200">
              <p>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">Καρτέλα:</span>{' '}
                {customer.crmNumber ?? 'Νέα καρτέλα'}
              </p>
              {customer.phoneMasked ? (
                <p className="mt-1">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">Τηλέφωνο:</span>{' '}
                  {customer.phoneMasked}
                </p>
              ) : null}
            </div>
          ) : loading ? (
            <p className="rounded-2xl bg-zinc-50 dark:bg-[#1e2b38] p-4 text-sm text-zinc-700 dark:text-zinc-200">Φόρτωση...</p>
          ) : null}

          {message && !submitted ? (
            <p
              role={isError ? 'alert' : undefined}
              className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                isError
                  ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                  : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
              }`}
            >
              {message}
            </p>
          ) : null}

          {customer && !submitted ? (
            <form action={`/api/intake/${encodeURIComponent(token)}`} method="post" onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Όνομα <span className="text-indigo-600">*</span></span>
                  <input
                    name="firstName"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                    placeholder="π.χ. Γιώργος"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Επώνυμο</span>
                  <input
                    name="lastName"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                    placeholder="π.χ. Παπαδόπουλος"
                  />
                </label>
              </div>

              <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="text-indigo-600">*</span> Συμπληρώστε όνομα ή επώνυμο. Τα υπόλοιπα είναι προαιρετικά.
              </p>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Εταιρεία <span className="font-normal text-zinc-400">(προαιρετικό)</span></span>
                <input
                  name="companyName"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  autoComplete="organization"
                  className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                  placeholder="π.χ. Παπαδόπουλος Ο.Ε."
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Email <span className="font-normal text-zinc-400">(προαιρετικό)</span></span>
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                  placeholder="name@example.com"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Διεύθυνση <span className="font-normal text-zinc-400">(προαιρετικό)</span></span>
                <input
                  name="address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  autoComplete="address-line1"
                  className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                  placeholder="Οδός & αριθμός"
                />
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Τ.Κ.</span>
                  <input
                    name="postalCode"
                    value={postalCode}
                    onChange={(event) => setPostalCode(event.target.value)}
                    autoComplete="postal-code"
                    inputMode="numeric"
                    className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                    placeholder="π.χ. 11521"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Περιοχή</span>
                  <input
                    name="region"
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    autoComplete="address-level2"
                    className="mt-1 h-12 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 text-base outline-none focus:border-indigo-400"
                    placeholder="π.χ. Αμπελόκηποι"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Τι χρειάζεστε; <span className="font-normal text-zinc-400">(προαιρετικό)</span></span>
                <textarea
                  name="needsSummary"
                  value={needsSummary}
                  onChange={(event) => setNeedsSummary(event.target.value)}
                  className="mt-1 min-h-20 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-3 text-base outline-none focus:border-indigo-400"
                  placeholder="Σύντομη περιγραφή της εργασίας/ανάγκης σας."
                />
              </label>

              <fieldset className="block">
                <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
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
                            : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] text-zinc-700 dark:text-zinc-200 hover:border-indigo-400'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Σχόλια</span>
                <textarea
                  name="comments"
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  className="mt-1 min-h-28 w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-3 text-base outline-none focus:border-indigo-400"
                  placeholder="Οτιδήποτε θέλετε να μας ενημερώσετε."
                />
              </label>

              <p className="flex items-center justify-center gap-1.5 text-center text-sm text-zinc-500 dark:text-zinc-400">
                <svg className="h-4 w-4 shrink-0" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                Τα στοιχεία χρησιμοποιούνται μόνο για την εξυπηρέτησή σας.
              </p>

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
            <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl bg-green-50 p-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </span>
              <div>
                <p className="text-lg font-bold text-green-700">Ευχαριστούμε!</p>
                <p className="mt-1 text-sm text-green-700">
                  {business
                    ? `Τα στοιχεία σου στάλθηκαν. Ο/Η ${business.name} θα επικοινωνήσει σύντομα μαζί σου.`
                    : 'Τα στοιχεία σου στάλθηκαν. Η επιχείρηση θα επικοινωνήσει σύντομα μαζί σου.'}
                </p>
              </div>
              {business?.phone ? (
                <button
                  type="button"
                  onClick={() => downloadVCard(business)}
                  className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-green-700 ring-1 ring-green-200 transition hover:bg-green-50"
                >
                  <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                  </svg>
                  Αποθήκευση επαφής
                </button>
              ) : null}
            </div>
          ) : null}

          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Ιδιωτική σελίδα — μόνο εσείς και η επιχείρηση έχετε πρόσβαση.
          </p>
        </section>
      </div>
    </main>
  );
}
