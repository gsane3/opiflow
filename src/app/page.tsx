import type { Metadata } from 'next';
import Link from 'next/link';
import StoreBadges from '@/components/marketing/StoreBadges';
import { OpiflowMark } from '@/components/brand/OpiflowLogo';
import NativeGate from '@/components/native/NativeGate';

export const metadata: Metadata = {
  title: 'Opiflow — Κάθε κλήση γίνεται ενέργεια',
  description:
    'Επαγγελματικό τηλέφωνο με AI για τεχνικούς. Κάθε κλήση γίνεται καρτέλα πελάτη, AI brief και επόμενη ενέργεια. Στείλε link στον πελάτη μέσω Viber και κλείσε τη δουλειά.',
  openGraph: {
    title: 'Opiflow — Κάθε κλήση γίνεται ενέργεια',
    description:
      'Κάθε κλήση γίνεται καρτέλα πελάτη, AI brief και επόμενη ενέργεια. Φτιαγμένο για τεχνικούς.',
    type: 'website',
    locale: 'el_GR',
  },
};

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <OpiflowMark className="h-8 w-8" />
      <span className="text-lg font-bold tracking-tight">
        <span className="text-zinc-900">opiflow</span>
        <span className="text-indigo-600">.ai</span>
      </span>
    </div>
  );
}

const FEATURES: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: 'Κλήσεις με AI brief',
    body: 'Δέξου ή κάνε κλήσεις από τον επαγγελματικό σου αριθμό. Μετά από κάθε κλήση παίρνεις περίληψη και επόμενη ενέργεια.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    ),
  },
  {
    title: 'Αυτόματο Viber link',
    body: 'Νέος πελάτης; Στέλνεται αυτόματα link για να συμπληρώσει τα στοιχεία του — και δένει με την καρτέλα του.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    ),
  },
  {
    title: 'Πλήρης καρτέλα πελάτη',
    body: 'Στοιχεία, ιστορικό, σημειώσεις, φωτογραφίες και timeline — όλα σε ένα μέρος, στο κινητό σου.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    ),
  },
  {
    title: 'Προσφορές & opportunity value',
    body: 'Φτιάξε και στείλε προσφορές. Κάθε προσφορά δίνει αξία ευκαιρίας στον πελάτη για στατιστικά πωλήσεων.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    ),
  },
  {
    title: 'Ραντεβού με ημερολόγιο',
    body: 'Κλείσε ραντεβού με link. Ο πελάτης το προσθέτει με ένα tap στο Google ή Apple ημερολόγιο.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    ),
  },
  {
    title: 'AI βοηθός με φωνή',
    body: 'Υπαγόρευσε στο κινητό: «κλείσε ραντεβού με τον Νίκο αύριο στις 10». Ο βοηθός το κάνει.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
    ),
  },
];

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Δέξου την κλήση', body: 'Ο πελάτης καλεί τον επαγγελματικό σου αριθμό μέσα από την εφαρμογή.' },
  { n: '2', title: 'Πάρε AI brief + link', body: 'Δημιουργείται περίληψη και στέλνεται αυτόματα Viber link στον νέο πελάτη.' },
  { n: '3', title: 'Πλήρης καρτέλα', body: 'Ο πελάτης συμπληρώνει στοιχεία, δένουν με το brief και έχεις έτοιμη καρτέλα CRM.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900">
      {/* On the native app: skip the marketing page → open the product (login). */}
      <NativeGate />
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/80 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Logo />
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
            >
              Σύνδεση
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              Δοκίμασε δωρεάν
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-gradient-to-b from-indigo-100/70 via-indigo-50/40 to-transparent" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pt-14 pb-16 md:grid-cols-2 md:pt-20 md:pb-24">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Φτιαγμένο για τεχνικούς
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-zinc-900 md:text-5xl">
              Το τηλέφωνό σου<br className="hidden md:block" /> γίνεται{' '}
              <span className="text-indigo-600">ενέργεια</span>.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-600 md:text-lg">
              Επαγγελματικό τηλέφωνο με AI. Κάθε κλήση γίνεται καρτέλα πελάτη, περίληψη και επόμενη
              ενέργεια. Στείλε link μέσω Viber και κλείσε τη δουλειά — όλα από το κινητό.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="rounded-2xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800"
              >
                Ξεκίνα δωρεάν
              </Link>
              <Link
                href="/login"
                className="rounded-2xl border border-zinc-200 bg-white px-6 py-3.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                Έχω λογαριασμό
              </Link>
            </div>
            <div className="mt-8">
              <p className="mb-2.5 text-xs font-medium text-zinc-400">Έρχεται σύντομα και ως εφαρμογή — για τώρα τρέχει άψογα στον browser του κινητού σου</p>
              <StoreBadges />
            </div>
          </div>

          {/* Phone mockup */}
          <div className="relative mx-auto w-full max-w-[300px]">
            <div className="rounded-[2.5rem] border-[10px] border-zinc-900 bg-zinc-900 shadow-2xl">
              <div className="overflow-hidden rounded-[1.9rem] bg-[#F5F5F7]">
                {/* status bar */}
                <div className="flex items-center justify-between bg-white px-5 pt-3 pb-2 text-[11px] font-semibold text-zinc-900">
                  <span>9:41</span>
                  <span className="flex items-center gap-1 text-zinc-400">●●●●</span>
                </div>
                <div className="space-y-3 px-4 pb-6 pt-2">
                  <div>
                    <p className="text-[10px] text-zinc-400">Τρίτη, 3 Ιουνίου</p>
                    <p className="text-lg font-bold text-zinc-900">Καλημέρα.</p>
                  </div>
                  {/* focus card */}
                  <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                    <p className="text-[10px] font-medium text-zinc-400">Επόμενη καλύτερη ενέργεια</p>
                    <div className="mt-2.5 flex items-start gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50">
                        <svg className="h-4.5 w-4.5 text-indigo-500" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </span>
                      <div>
                        <p className="text-[10px] font-medium text-zinc-400">Νίκος Παπαδόπουλος</p>
                        <p className="text-[13px] font-semibold leading-snug text-zinc-900">Στείλε προσφορά για A/C 12.000 BTU</p>
                      </div>
                    </div>
                    <div className="mt-3 inline-flex rounded-xl bg-indigo-600 px-3.5 py-1.5 text-[11px] font-semibold text-white">Άνοιγμα</div>
                  </div>
                  {/* call → brief card */}
                  <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-zinc-200/60">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-50">
                        <svg className="h-3.5 w-3.5 text-green-600" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-zinc-800">Εισερχόμενη κλήση · 3:24</p>
                        <p className="truncate text-[10px] text-zinc-400">AI brief: ζητά A/C, διαμέρισμα 60τμ…</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* bottom nav */}
                <div className="flex items-center justify-around border-t border-zinc-200 bg-white py-2.5 text-[9px] text-zinc-400">
                  <span className="text-indigo-600">Αρχική</span>
                  <span>Κλήσεις</span>
                  <span>Πελάτες</span>
                  <span>AI</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-zinc-100 bg-zinc-50/60">
        <div className="mx-auto max-w-6xl px-5 py-5">
          <p className="text-center text-sm text-zinc-500">
            Για ψυκτικούς, υδραυλικούς, ηλεκτρολόγους, τεχνικούς και κάθε επαγγελματία που δουλεύει με το τηλέφωνο.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">
            Ό,τι χρειάζεσαι, σε μία εφαρμογή
          </h2>
          <p className="mt-3 text-base text-zinc-600">
            Όχι ένα βαρύ CRM υπολογιστή — ένας πρακτικός βοηθός για το κινητό σου.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-zinc-200/60 transition hover:shadow-md">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50">
                <svg className="h-5.5 w-5.5 text-indigo-600" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {f.icon}
                </svg>
              </span>
              <h3 className="mt-4 text-base font-semibold text-zinc-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-zinc-50/60 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">Πώς δουλεύει</h2>
            <p className="mt-3 text-base text-zinc-600">Από την κλήση στην έτοιμη καρτέλα, σε τρία βήματα.</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-[28px] bg-white p-7 shadow-sm ring-1 ring-zinc-200/60">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-base font-bold text-white">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-zinc-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Download CTA */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="overflow-hidden rounded-[36px] bg-indigo-600 px-6 py-14 text-center shadow-sm md:px-12">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white md:text-4xl">
            Ξεκίνα σήμερα. Δούλεψε πιο έξυπνα αύριο.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base text-indigo-100">
            Δοκίμασε δωρεάν στον browser ή κατέβασέ το στο κινητό σου.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <Link
              href="/register"
              className="rounded-2xl bg-white px-7 py-3.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50"
            >
              Δοκίμασε δωρεάν στον browser
            </Link>
            <StoreBadges theme="dark" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Logo />
          <div className="flex flex-wrap items-center justify-center gap-5 text-sm text-zinc-500">
            <Link href="/login" className="transition hover:text-zinc-800">Σύνδεση</Link>
            <Link href="/register" className="transition hover:text-zinc-800">Εγγραφή</Link>
            <Link href="/privacy" className="transition hover:text-zinc-800">Απόρρητο</Link>
            <Link href="/terms" className="transition hover:text-zinc-800">Όροι χρήσης</Link>
          </div>
          <p className="text-center text-xs leading-relaxed text-zinc-400 sm:text-right">
            © 2026 opiflow.ai<br />
            Αντιπλημμυρικά Ελλάδος ΙΚΕ · ΑΦΜ 803311450 · ΓΕΜΗ 194339601000
          </p>
        </div>
      </footer>
    </div>
  );
}
