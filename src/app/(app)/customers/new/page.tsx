'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Card, Input, Button } from '@/components/ui';

export default function NewCustomerPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const firstErr = touched && !firstName.trim() ? 'Υποχρεωτικό' : undefined;
  const lastErr = touched && !lastName.trim() ? 'Υποχρεωτικό' : undefined;
  const phoneErr = touched && !phone.trim() ? 'Υποχρεωτικό' : undefined;
  const valid = Boolean(firstName.trim() && lastName.trim() && phone.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!valid) return;

    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError('Δεν υπάρχει σύνδεση. Δοκίμασε ξανά.');
        setBusy(false);
        return;
      }

      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      const num = phone.trim();

      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        // Store the number in both phone + mobilePhone (the app's convention),
        // so it shows in the list, the tel: link, and Viber sends all work.
        body: JSON.stringify({
          name,
          phone: num,
          mobilePhone: num,
          email: email.trim() || null,
          companyName: company.trim() || null,
          source: 'manual_entry',
        }),
      });

      const json = await res.json();
      const newId = json?.customer?.id;
      if (res.ok && json.ok === true && typeof newId === 'string') {
        // Open the full customer card.
        router.push(`/customers/${newId}`);
        return;
      }
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      setBusy(false);
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-2xl">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/customers"
          aria-label="Πίσω"
          className="rounded-full bg-white dark:bg-[#17232f] p-2 text-zinc-500 dark:text-zinc-400 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Πελάτες</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Νέος πελάτης</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <Card padding="lg" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Όνομα"
              required
              autoFocus
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={firstErr}
            />
            <Input
              label="Επώνυμο"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={lastErr}
            />
          </div>

          <Input
            label="Τηλέφωνο"
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="π.χ. 69…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={phoneErr}
          />

          <Input
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            hint="Προαιρετικό"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            label="Εταιρεία"
            hint="Προαιρετικό"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />

          {error && <p className="text-sm text-red-600">{error}</p>}
        </Card>

        <div className="mt-5 flex gap-3">
          <Button type="submit" size="lg" fullWidth loading={busy}>
            Αποθήκευση
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            onClick={() => router.push('/customers')}
          >
            Άκυρο
          </Button>
        </div>
      </form>
    </div>
  );
}
