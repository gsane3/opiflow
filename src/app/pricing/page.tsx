import type { Metadata } from 'next';
import Link from 'next/link';
import { OpiflowMark } from '@/components/brand/OpiflowLogo';
import {
  TIERS, ADDONS, COMPARISON, exVatLabel, type Cell,
} from '@/lib/billing/tiers';

export const metadata: Metadata = {
  title: 'Τιμές & πακέτα — Opiflow',
  description:
    'Διάλεξε το πακέτο σου. Base για όλη τη δουλειά σου, Premium με επαγγελματικό τηλέφωνο & AI. Πρόσθετα: τιμολόγηση ΑΑΔΕ και εργαλεία αλουμινίου/ξυλουργικής. Όλες οι τιμές + ΦΠΑ.',
  // Link-only page: reachable by direct URL, but kept OUT of search engines.
  // noindex is the authoritative "don't index" signal (the page stays crawlable so
  // engines can actually SEE the noindex); it's also absent from the sitemap and has
  // no internal links pointing to it.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  openGraph: { title: 'Τιμές & πακέτα — Opiflow', type: 'website', locale: 'el_GR' },
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Opiflow — αρχική">
      <OpiflowMark className="h-8 w-8" />
      <span className="text-lg font-bold tracking-tight">
        <span className="text-zinc-900">opiflow</span><span className="text-indigo-600">.ai</span>
      </span>
    </Link>
  );
}

function Check() {
  return (
    <svg className="mx-auto h-[18px] w-[18px] text-indigo-600" viewBox="0 0 24 24" fill="none" strokeWidth={2.4} stroke="currentColor" aria-label="Ναι">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
function Dash() {
  return <span className="mx-auto block h-px w-3.5 bg-zinc-300" aria-label="Όχι" />;
}

function Mark({ v }: { v: Cell }) {
  if (v === true) return <Check />;
  if (v === false) return <Dash />;
  return <span className="block text-center text-[11px] font-semibold leading-tight text-zinc-500">{v}</span>;
}

export default function PricingPage() {
  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/80 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Logo />
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100">Σύνδεση</Link>
            <Link href="/register" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">Δοκίμασε δωρεάν</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-gradient-to-b from-indigo-100/70 via-indigo-50/40 to-transparent" />
        <div className="relative mx-auto max-w-3xl px-5 pt-14 pb-10 text-center md:pt-20">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Ετήσια συνδρομή · πολύ οικονομικά
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl">
            Διάλεξε το <span className="text-indigo-600">πακέτο</span> σου.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-600 md:text-lg">
            Ένα απλό, οικονομικό ετήσιο πακέτο για όλη τη δουλειά σου — και πρόσθετα όποτε τα θελήσεις.
            Χωρίς δεσμεύσεις, χωρίς κρυφές χρεώσεις.
          </p>
        </div>
      </section>

      {/* Plan cards */}
      <section className="mx-auto max-w-5xl px-5">
        <div className="grid items-start gap-6 md:grid-cols-2">
          {TIERS.map((t) => (
            <div
              key={t.key}
              className={
                t.highlight
                  ? 'relative rounded-[32px] bg-zinc-900 p-7 text-white shadow-xl ring-1 ring-zinc-900'
                  : 'relative rounded-[32px] bg-white p-7 shadow-sm ring-1 ring-zinc-200/70 transition hover:shadow-md'
              }
            >
              {t.badge && (
                <span className="absolute right-6 top-6 rounded-full bg-indigo-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                  {t.badge}
                </span>
              )}
              <p className={t.highlight ? 'text-sm font-semibold text-indigo-300' : 'text-sm font-semibold text-indigo-600'}>{t.name}</p>
              <div className="mt-3 flex items-end gap-1.5">
                <span className="text-5xl font-bold tracking-tight">{exVatLabel(t.priceExVat)}</span>
                <span className={'mb-1.5 text-sm font-medium ' + (t.highlight ? 'text-zinc-400' : 'text-zinc-500')}>+ ΦΠΑ / έτος</span>
              </div>
              <p className={'mt-1 text-xs ' + (t.highlight ? 'text-zinc-400' : 'text-zinc-400')}>{t.perMonthHint}</p>
              <p className={'mt-4 text-sm leading-relaxed ' + (t.highlight ? 'text-zinc-300' : 'text-zinc-600')}>{t.tagline}</p>

              <Link
                href={`/register?plan=${t.key}`}
                className={
                  'mt-6 block rounded-2xl py-3.5 text-center text-sm font-semibold shadow-sm transition ' +
                  (t.highlight
                    ? 'bg-white text-zinc-900 hover:bg-indigo-50'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700')
                }
              >
                {t.ctaLabel}
              </Link>

              <ul className="mt-6 space-y-2.5">
                {t.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <svg className={'mt-0.5 h-[18px] w-[18px] shrink-0 ' + (t.highlight ? 'text-indigo-400' : 'text-indigo-600')} viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span className={'text-sm leading-snug ' + (t.highlight ? 'text-zinc-200' : 'text-zinc-700')}>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-zinc-400">Όλες οι τιμές είναι εκτός ΦΠΑ (24%). Ετήσια χρέωση, ακύρωση οποτεδήποτε.</p>
      </section>

      {/* Add-ons */}
      <section className="mx-auto max-w-5xl px-5 pt-16">
        <div className="mb-7 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Πρόσθεσε όποτε θες</h2>
          <p className="mt-2 text-sm text-zinc-600">Προαιρετικά πρόσθετα πάνω σε Base ή Premium.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {ADDONS.map((a) => {
            const amber = a.accent === 'amber';
            return (
              <div
                key={a.key}
                className={
                  'relative rounded-[28px] bg-white p-6 shadow-sm ring-1 transition hover:shadow-md ' +
                  (amber ? 'ring-amber-200/70' : 'ring-indigo-200/70')
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold ' + (amber ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700')}>
                    {a.forWho}
                  </span>
                  {a.badge && <span className={'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ' + (amber ? 'bg-amber-500 text-white' : 'bg-indigo-500 text-white')}>{a.badge}</span>}
                </div>
                <h3 className="mt-3.5 text-lg font-bold tracking-tight">{a.name}</h3>
                <p className={'mt-1 text-base font-semibold ' + (amber ? 'text-amber-700' : 'text-indigo-700')}>{a.priceLabel} <span className="text-xs font-medium text-zinc-400">+ ΦΠΑ</span></p>
                <p className="mt-2.5 text-sm leading-relaxed text-zinc-600">{a.tagline}</p>
                <ul className="mt-4 space-y-2">
                  {a.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <span className={'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' + (amber ? 'bg-amber-500' : 'bg-indigo-500')} />
                      <span className="text-sm leading-snug text-zinc-700">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Comparison table */}
      <section className="mx-auto max-w-5xl px-5 pt-20">
        <div className="mb-7 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Αναλυτική σύγκριση</h2>
          <p className="mt-2 text-sm text-zinc-600">Όλα τα features, ένα προς ένα.</p>
        </div>

        <div className="overflow-hidden rounded-[28px] ring-1 ring-zinc-200/70">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="sticky top-[57px] z-10 bg-white/95 backdrop-blur">
                <th className="w-1/2 px-4 py-4 text-sm font-semibold text-zinc-400 sm:px-6">Χαρακτηριστικά</th>
                {TIERS.map((t) => (
                  <th key={t.key} className={'px-2 py-4 text-center align-bottom ' + (t.highlight ? 'bg-indigo-50/50' : '')}>
                    <span className="block text-sm font-bold text-zinc-900">{t.name}</span>
                    <span className="block text-xs font-medium text-zinc-400">{exVatLabel(t.priceExVat)} + ΦΠΑ</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((g) => (
                <GroupRows key={g.title} title={g.title} rows={g.rows} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {TIERS.map((t) => (
            <Link key={t.key} href={`/register?plan=${t.key}`} className={'rounded-2xl py-3.5 text-center text-sm font-semibold shadow-sm transition ' + (t.highlight ? 'bg-zinc-900 text-white hover:bg-zinc-800' : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
              {t.ctaLabel} — {exVatLabel(t.priceExVat)} + ΦΠΑ
            </Link>
          ))}
        </div>
      </section>

      {/* Highlights — selling spotlights */}
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-8">
        <div className="mb-9 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Γιατί το αγαπούν οι τεχνικοί</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <Spotlight
            tone="indigo" tag="Premium"
            title="Ο AI ακούει για σένα"
            body="Κάθε κλήση ηχογραφείται (με νόμιμη γνωστοποίηση), απομαγνητοφωνείται και βγαίνει AI σύνοψη με «Επόμενα βήματα». Κλείνεις το τηλέφωνο και ξέρεις ακριβώς τι υποσχέθηκες."
          />
          <Spotlight
            tone="amber" tag="Add-on ALUMIL"
            title="Μέτρα με laser, βγάλε προσφορά"
            body="Μετράς με Bluetooth laser, οι διαστάσεις μπαίνουν μόνες τους, στέλνεις στην ALUMIL με μία κίνηση και η προσφορά στον πελάτη φτιάχνεται αυτόματα. Μηδέν χαρτάκια."
          />
          <Spotlight
            tone="indigo" tag="Add-on ΑΑΔΕ"
            title="Τιμολόγιο με μία εντολή"
            body="«Τύπωσε τιμολόγιο 124€ στον Παπαδόπουλο» — βγαίνει επίσημο παραστατικό και φεύγει στο myDATA αυτόματα. Στο κόστος, χωρίς κέρδος για εμάς."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-12 md:py-16">
        <div className="overflow-hidden rounded-[36px] bg-indigo-600 px-6 py-14 text-center shadow-sm md:px-12">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white md:text-4xl">Ξεκίνα σήμερα. Δούλεψε πιο έξυπνα αύριο.</h2>
          <p className="mx-auto mt-3 max-w-md text-base text-indigo-100">Δοκίμασε δωρεάν στον browser — χωρίς κάρτα.</p>
          <Link href="/register" className="mt-8 inline-block rounded-2xl bg-white px-7 py-3.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50">Δοκίμασε δωρεάν</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Logo />
          <div className="flex flex-wrap items-center justify-center gap-5 text-sm text-zinc-500">
            <Link href="/" className="transition hover:text-zinc-800">Αρχική</Link>
            <Link href="/login" className="transition hover:text-zinc-800">Σύνδεση</Link>
            <Link href="/privacy" className="transition hover:text-zinc-800">Απόρρητο</Link>
            <Link href="/terms" className="transition hover:text-zinc-800">Όροι χρήσης</Link>
          </div>
          <p className="text-center text-xs leading-relaxed text-zinc-400 sm:text-right">© 2026 opiflow.ai<br />Όλες οι τιμές + ΦΠΑ 24%</p>
        </div>
      </footer>
    </div>
  );
}

function GroupRows({ title, rows }: { title: string; rows: { label: string; base: Cell; premium: Cell }[] }) {
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-zinc-50/80 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-indigo-700 sm:px-6">{title}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label} className="border-t border-zinc-100 transition hover:bg-zinc-50/60">
          <td className="px-4 py-3 text-sm leading-snug text-zinc-700 sm:px-6">{r.label}</td>
          <td className="px-2 py-3"><Mark v={r.base} /></td>
          <td className="bg-indigo-50/30 px-2 py-3"><Mark v={r.premium} /></td>
        </tr>
      ))}
    </>
  );
}

function Spotlight({ tone, tag, title, body }: { tone: 'indigo' | 'amber'; tag: string; title: string; body: string }) {
  const amber = tone === 'amber';
  return (
    <div className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-zinc-200/60">
      <span className={'inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ' + (amber ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700')}>{tag}</span>
      <h3 className="mt-3.5 text-lg font-semibold tracking-tight text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
    </div>
  );
}
