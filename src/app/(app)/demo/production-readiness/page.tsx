'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState } from '@/lib/storage';

interface GapRow {
  area: string;
  mvpState: string;
  productionNeed: string;
  priority: 'high' | 'medium' | 'low';
}

const GAP_TABLE: GapRow[] = [
  { area: 'Authentication', mvpState: 'None — single-user, no login', productionNeed: 'User auth (email/password or OAuth)', priority: 'high' },
  { area: 'Data storage', mvpState: 'localStorage (browser-only)', productionNeed: 'Cloud database (Postgres / Supabase)', priority: 'high' },
  { area: 'Multi-device sync', mvpState: 'Not available', productionNeed: 'Real-time sync via cloud backend', priority: 'high' },
  { area: 'VoIP / calling', mvpState: 'Demo only — no real calls', productionNeed: 'SIP/WebRTC provider (Twilio, Vonage)', priority: 'high' },
  { area: 'Call recording', mvpState: 'No recording at all', productionNeed: 'Provider recording + consent flow + storage', priority: 'high' },
  { area: 'SMS sending', mvpState: 'native sms: link only', productionNeed: 'SMS provider API (Twilio, Vonage)', priority: 'high' },
  { area: 'Email delivery', mvpState: 'Manual draft copy available. Optional real send via Resend when RESEND_API_KEY and EMAIL_FROM are configured; safe preview mode intentionally omits these.', productionNeed: 'Auth and quota safety before enabling real email mode in production. Audit logging for sent emails.', priority: 'medium' },
  { area: 'Backup / restore', mvpState: 'Local JSON download/upload', productionNeed: 'Cloud backup with versioning', priority: 'medium' },
  { area: 'Team / multi-user', mvpState: 'Single user, no roles', productionNeed: 'Team workspaces, role-based access', priority: 'medium' },
  { area: 'Audit logging', mvpState: 'None', productionNeed: 'Immutable action log per record', priority: 'medium' },
  { area: 'GDPR consent', mvpState: 'No consent flows', productionNeed: 'Consent collection, opt-out, data export', priority: 'high' },
  { area: 'Data encryption', mvpState: 'None (plaintext localStorage)', productionNeed: 'Encryption at rest and in transit', priority: 'high' },
  { area: 'Offer e-signature', mvpState: 'Demo acceptance link only', productionNeed: 'Real e-signature or PDF with timestamp', priority: 'medium' },
  { area: 'AI API key', mvpState: 'Server-side ANTHROPIC_API_KEY required for provider calls. Missing key returns 503 no_api_key; route does not fall back to demo output.', productionNeed: 'Server-side key management, rate limiting', priority: 'medium' },
  { area: 'Analytics', mvpState: 'Local browser counts only', productionNeed: 'Server-side reporting, dashboards', priority: 'low' },
];

const PRIORITY_LABEL: Record<string, string> = {
  high: 'Υψηλή',
  medium: 'Μεσαία',
  low: 'Χαμηλή',
};

const PRIORITY_CLS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-zinc-100 text-zinc-500',
};

const PILOT_ITEMS = [
  { id: 'data', label: 'Demo δεδομένα έτοιμα', note: 'Επαναφορά από Ρυθμίσεις > Demo και επαναφορά.' },
  { id: 'backup', label: 'Backup δοκιμασμένο', note: 'Λήψη backup JSON και επιβεβαίωση περιεχομένου.' },
  { id: 'restore', label: 'Restore δοκιμασμένο', note: 'Επαναφορά backup σε νέο browser tab — επιβεβαίωση preview.' },
  { id: 'csv', label: 'CSV εισαγωγή / εξαγωγή δοκιμασμένα', note: 'Εξαγωγή πελατών + εισαγωγή σε νέα λίστα.' },
  { id: 'claims', label: 'Δεν εμφανίζονται fake ισχυρισμοί', note: 'Έλεγχος: VoIP, SMS, cloud, αποστολή email.' },
  { id: 'apikey', label: 'AI API key ρυθμισμένο ή missing-key συμπεριφορά δοκιμασμένη', note: 'Χωρίς ANTHROPIC_API_KEY: το API επιστρέφει 503 no_api_key, όχι demo αποτέλεσμα.' },
  { id: 'support', label: 'Διαδικασία υποστήριξης pilot users έτοιμη', note: 'Email / WhatsApp για αναφορά bugs και ερωτήσεις.' },
  { id: 'limits', label: 'Γνωστοί περιορισμοί κοινοποιημένοι', note: 'Τοπική αποθήκευση, χωρίς sync, χωρίς VoIP.' },
  { id: 'legal', label: 'Νομικός / GDPR έλεγχος: ΔΕΝ έχει γίνει', note: 'Pilot μόνο — δεν χρησιμοποιείται για πραγματικά δεδομένα παραγωγής.' },
  { id: 'feedback', label: 'Ερωτήσεις feedback pilot users έτοιμες', note: 'π.χ. ροή, ταχύτητα, demo σενάρια, αναφορά προβλημάτων.' },
];

function PilotChecklist() {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const doneCount = checked.size;
  const total = PILOT_ITEMS.length;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500">{doneCount} / {total} ολοκληρωμένα</p>
          {doneCount > 0 && (
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
            >
              Καθαρισμός
            </button>
          )}
        </div>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-1.5 rounded-full bg-indigo-500 transition-all"
            style={{ width: `${(doneCount / total) * 100}%` }}
          />
        </div>
      </div>
      <ul className="space-y-3">
        {PILOT_ITEMS.map((item) => {
          const done = checked.has(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="flex w-full items-start gap-3 text-left"
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                  done ? 'border-indigo-600 bg-indigo-600' : 'border-zinc-300 bg-white'
                }`}>
                  {done && (
                    <svg className="h-2.5 w-2.5 text-white" fill="none" strokeWidth={3} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${done ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-zinc-400">{item.note}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-amber-700">
        Η λίστα δεν αποθηκεύεται. Εσωτερική χρήση μόνο — δεν αντιστοιχεί σε production readiness.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
      {children}
    </section>
  );
}

interface LocalCounts {
  customers: number;
  tasks: number;
  tasksOpen: number;
  tasksCompleted: number;
  offers: number;
  calls: number;
  communications: number;
}

export default function ProductionReadinessPage() {
  const [counts, setCounts] = useState<LocalCounts | null>(null);

  useEffect(() => {
    const state = loadState();
    const tasks = state.tasks ?? [];
    const timer = window.setTimeout(() => {
      setCounts({
        customers: state.customers?.length ?? 0,
        tasks: tasks.length,
        tasksOpen: tasks.filter((t) => t.status === 'open').length,
        tasksCompleted: tasks.filter((t) => t.status === 'completed').length,
        offers: state.offers?.length ?? 0,
        calls: state.calls?.length ?? 0,
        communications: state.communications?.length ?? 0,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Internal report
          </div>
          <Link href="/demo" className="text-xs text-zinc-400 hover:text-zinc-600">
            ← Demo οδηγός
          </Link>
        </div>
        <h1 className="text-xl font-bold text-zinc-900">Production Readiness Gap Report</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Internal reference — MVP status vs. production requirements. Do not share with customers.
        </p>
      </div>

      {/* What is real in the MVP */}
      <Section title="Τι είναι πραγματικό στο MVP">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
          {[
            'LocalStorage CRM: πελάτες, tasks, προσφορές, κλήσεις, επικοινωνίες.',
            'AI review με Claude API — όταν υπάρχει ANTHROPIC_API_KEY.',
            'CSV εισαγωγή και εξαγωγή πελατών.',
            'Backup / restore τοπικού JSON.',
            'Έλεγχος υγείας δεδομένων τοπικά.',
            'Mobile-first UI με ελληνικό copy.',
            'Υπαγόρευση μέσω Web Speech API (browser-native).',
            'Native tel: / sms: links για κλήση και SMS από συσκευή.',
            'Αντιγραφή draft Viber / email χειροκίνητα.',
            'Προαιρετική πραγματική αποστολή email μέσω Resend, μόνο όταν RESEND_API_KEY και EMAIL_FROM είναι ρυθμισμένα στον server. Safe preview mode παραλείπει αυτά τα vars σκόπιμα.',
            'AI εντολές (/cmd) με 5 intents: query_appointments, create_task, create_appointment, create_offer, cancel_appointment. Απαιτεί έλεγχο χρήστη πριν αποθήκευση. Ακύρωση ραντεβού με ξεχωριστή επιβεβαίωση.',
            'Πρόγραμμα ραντεβού (/appointments): δημιουργία, επισκόπηση, ακύρωση ραντεβού (soft cancel, με inline επιβεβαίωση). Ακύρωση υπάρχει επίσης σε CustomerProfile και /cmd.',
            'Customer intake form (/customer-intake/[id]): δημόσια φόρμα συμπλήρωσης στοιχείων. Demo/localStorage μόνο. Λειτουργεί μόνο στον ίδιο browser όπου υπάρχουν τα CRM δεδομένα.',
            'Αντιγραφή intake link από CustomerProfile (clipboard copy). Demo link. Δεν γίνεται αυτόματη αποστολή.',
            'Inline επιβεβαίωση για όλες τις καταστρεπτικές ενέργειες: διαγραφή πελάτη, διαγραφή προσφοράς, διαγραφή task, συγχώνευση duplicates, εισαγωγή CSV, ακύρωση guided demo. Μηδέν window.confirm ή alert() στον κώδικα (src/).',
          ].map((item) => (
            <div key={item} className="flex items-start gap-2 text-sm text-zinc-700">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* What is demo/local */}
      <Section title="Τι είναι demo / τοπικό μόνο">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
          {[
            'Demo κλήση — δεν υπάρχει VoIP ή ηχογράφηση.',
            'Demo χαμένες κλήσεις — στατικά δεδομένα.',
            'SMS intake — demo timers, χωρίς πραγματικό SMS.',
            'Provider readiness badges — όλοι οι πάροχοι είναι Demo.',
            'Cloud sync — δεν υπάρχει.',
            'Offer acceptance — demo link, χωρίς πραγματική υπογραφή.',
            'Multi-user / team — δεν υπάρχει.',
            'Audit log — δεν υπάρχει.',
          ].map((item) => (
            <div key={item} className="flex items-start gap-2 text-sm text-zinc-700">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* Gap table */}
      <Section title="Production Gap Table">
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">Area</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">MVP State</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">Production Need</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {GAP_TABLE.map((row) => (
                <tr key={row.area}>
                  <td className="px-4 py-2.5 font-medium text-zinc-800">{row.area}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{row.mvpState}</td>
                  <td className="px-4 py-2.5 text-zinc-700">{row.productionNeed}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${PRIORITY_CLS[row.priority]}`}>
                      {PRIORITY_LABEL[row.priority]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* VoIP risks */}
      <Section title="VoIP Risks">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2 text-sm text-zinc-700">
          <p>Call recording is subject to local consent laws. In Greece (and EU generally), both parties must be informed before recording. A consent flow is required before any call recording feature can launch.</p>
          <p>SIP/WebRTC infrastructure requires careful latency management. Provider selection (Twilio Voice, Vonage, local Greek carrier) affects cost, quality and regulatory compliance.</p>
          <p>PSTN termination costs vary significantly by carrier and destination. Budget planning is needed before VoIP goes live.</p>
        </div>
      </Section>

      {/* SMS/Provider risks */}
      <Section title="SMS / Provider Risks">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2 text-sm text-zinc-700">
          <p>SMS delivery rates in Greece vary by provider. Alphanumeric sender IDs are regulated. DLR (delivery receipt) handling needs server-side state, not localStorage.</p>
          <p>GDPR opt-out must be implemented before commercial SMS sending. Users must be able to unsubscribe and have their number removed.</p>
          <p>SMS costs at scale can be significant. Choose provider with per-country pricing clarity (Twilio or local reseller).</p>
        </div>
      </Section>

      {/* GDPR / Legal */}
      <Section title="GDPR / Privacy / Legal">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2 text-sm text-zinc-700">
          <p>The current MVP stores all data in browser localStorage. No GDPR consent flows exist. No data processing agreement (DPA) is in place.</p>
          <p>Before commercial use, the following are required:</p>
          <ul className="space-y-1 ml-4">
            {[
              'Privacy policy and terms of service.',
              'Consent collection before capturing customer data.',
              'Right-to-erasure workflow (delete customer and all linked records).',
              'Data export capability for data subject access requests.',
              'DPA with any sub-processors (AI provider, hosting, SMS provider).',
              'Legal review by qualified GDPR counsel.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="font-medium text-zinc-800">This MVP does not claim legal compliance. Do not use commercially without completing the above.</p>
        </div>
      </Section>

      {/* Data / Backend / Auth gaps */}
      <Section title="Data / Backend / Auth Gaps">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2 text-sm text-zinc-700">
          {[
            'No user authentication — anyone with browser access sees all data.',
            'No server-side validation — all data is trusted from the client.',
            'No multi-device sync — data exists only in one browser.',
            'No cloud backup — data is lost if localStorage is cleared.',
            'No audit trail — no record of who changed what and when.',
            'No soft-delete — deleted records cannot be recovered from the app.',
          ].map((item) => (
            <div key={item} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* MVP 2 priorities */}
      <Section title="MVP 2 Priorities">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
          <ol className="space-y-3">
            {[
              { n: 1, text: 'Cloud backend + auth (Supabase or similar). Prerequisite for everything else.' },
              { n: 2, text: 'GDPR consent flows + right-to-erasure. Legal prerequisite for commercial use.' },
              { n: 3, text: 'VoIP integration — at minimum call routing and brief capture. Core product value.' },
              { n: 4, text: 'SMS provider (Twilio recommended for Greece). Enables intake and follow-up automation.' },
              { n: 5, text: 'Email offer delivery: backend route exists (POST /api/email/send-offer). Remaining work is auth, quota safety, audit logging, and deciding when to enable real email mode in deployed instances.' },
              { n: 6, text: 'Team / multi-user support. Required for business use beyond single owner.' },
              { n: 7, text: 'Audit logging. Required for compliance and support.' },
            ].map(({ n, text }) => (
              <li key={n} className="flex items-start gap-3 text-sm text-zinc-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                  {n}
                </span>
                {text}
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Step 119: Pilot metrics dashboard */}
      <Section title="Pilot Metrics (τοπικά)">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
          <p className="text-xs text-zinc-400">
            Τοπικά δεδομένα μόνο — δεν είναι product analytics, δεν υπάρχει tracking.
          </p>
          {counts ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Πελάτες', value: counts.customers },
                { label: 'Κλήσεις (mock)', value: counts.calls },
                { label: 'Επικοινωνίες', value: counts.communications },
                { label: 'Προσφορές', value: counts.offers },
                { label: 'Tasks ανοιχτά', value: counts.tasksOpen },
                { label: 'Tasks ολοκλ.', value: counts.tasksCompleted },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-zinc-50 px-3 py-2.5 text-center ring-1 ring-zinc-100">
                  <p className="text-lg font-bold text-zinc-900">{value}</p>
                  <p className="text-xs text-zinc-400">{label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Φόρτωση...</p>
          )}
          <p className="text-xs text-zinc-400">
            Οι κλήσεις και επικοινωνίες χρησιμοποιούνται ως proxy για AI review χρήση.
          </p>
        </div>
      </Section>

      {/* Step 118: AI usage estimator */}
      <Section title="Τοπική εκτίμηση χρήσης">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
          <p className="text-xs text-zinc-400">
            Εκτίμηση από τοπικά δεδομένα — δεν είναι χρέωση. Δεν γίνεται tracking.
          </p>
          {counts ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-zinc-600">
                <span>Πελάτες στο CRM</span>
                <span className="font-semibold text-zinc-900">{counts.customers}</span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Κλήσεις / AI reviews (proxy)</span>
                <span className="font-semibold text-zinc-900">
                  {counts.calls + counts.communications}
                </span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Προσφορές δημιουργημένες</span>
                <span className="font-semibold text-zinc-900">{counts.offers}</span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Tasks συνολικά</span>
                <span className="font-semibold text-zinc-900">{counts.tasks}</span>
              </div>
              <div className="border-t border-zinc-100 pt-2 text-xs text-zinc-400">
                Σε production, η χρέωση AI θα βασίζεται σε tokens per call — όχι σε αυτούς
                τους αριθμούς. Αυτό είναι rough proxy μόνο για εσωτερική χρήση.
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Φόρτωση...</p>
          )}
        </div>
      </Section>

      {/* Step 152: Known issues for pilot */}
      <Section title="Known issues για pilot">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
          {[
            { issue: 'Τοπική αποθήκευση', detail: 'Τα δεδομένα μπορεί να διαγραφούν αν καθαριστεί το localStorage του browser.' },
            { issue: 'Demo links μόνο στον ίδιο browser', detail: 'Τα /offer-response/[id], /appointment-response/[id] και /customer-intake/[id] δεν λειτουργούν σε άλλο browser ή συσκευή.' },
            { issue: 'Χωρίς cloud sync', detail: 'Δεν υπάρχει συγχρονισμός μεταξύ συσκευών ή browser tabs.' },
            { issue: 'Χωρίς πραγματικό SMS', detail: 'Δεν υπάρχει SMS provider. Οι επικοινωνίες γίνονται με αντιγραφή κειμένου ή native sms: link.' },
            { issue: 'Email: πραγματικό μόνο όταν ρυθμιστεί', detail: 'Πραγματική αποστολή email υπάρχει μόνο όταν RESEND_API_KEY και EMAIL_FROM είναι ρυθμισμένα. Safe preview mode δεν τα έχει.' },
            { issue: 'Χωρίς VoIP ή ηχογράφηση', detail: 'Η demo κλήση δεν συνδέεται με πραγματικό πάροχο.' },
            { issue: 'Χωρίς νομικό / e-signature', detail: 'Η αποδοχή προσφοράς δεν αποτελεί νόμιμη υπογραφή.' },
            { issue: 'Δεν είναι production-safe', detail: 'Μην αποθηκεύεις πραγματικά δεδομένα παραγωγής σε αυτό το MVP.' },
            { issue: 'Print / export εξαρτάται από browser', detail: 'Η εκτύπωση προσφορών εξαρτάται από τις ρυθμίσεις του browser και OS.' },
          ].map(({ issue, detail }) => (
            <div key={issue} className="flex items-start gap-2 text-sm">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <div className="min-w-0">
                <span className="font-medium text-zinc-700">{issue}: </span>
                <span className="text-zinc-500">{detail}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Step 160: Vercel post-deploy smoke test checklist */}
      <Section title="Post-deploy Smoke Test (Vercel)">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
          <p className="text-xs text-zinc-400">
            After every Vercel deploy, open each route and confirm it loads correctly.
          </p>
          <div className="space-y-2">
            {[
              { route: '/demo', check: 'Loads, guided demo CTA visible without scrolling, data card shows.' },
              { route: '/demo (guided start)', check: 'Click "Ξεκινα guided demo" -> lands on /dashboard with guide=1 banner.' },
              { route: '/demo (wrong click)', check: 'Navigate away during guide -> GlobalGuideGuard banner appears.' },
              { route: '/demo (empty browser)', check: 'Clear localStorage -> visit /demo -> rich demo data auto-seeds.' },
              { route: '/dashboard', check: 'Loads, sections render, no console errors.' },
              { route: '/ai-review', check: 'Demo result loads, GuidedDemoBanner shows in guide mode.' },
              { route: '/customers', check: 'Customer list loads, empty state correct.' },
              { route: '/customers/demo-karagiannis', check: 'Customer profile loads with demo data, timeline visible.' },
              { route: '/tasks', check: 'Tabs render, empty state correct.' },
              { route: '/offers', check: 'List loads, create offer works.' },
              { route: '/offers/demo-offer-1', check: 'Offer detail loads, print preview works, followup step in guide mode.' },
              { route: '/offer-response/demo-offer-1', check: 'Accept/reject shows, Next disabled until action, comm record added.' },
              { route: '/settings', check: 'All sections load, backup download works.' },
              { route: '/demo/pilot-feedback', check: 'Feedback form loads, Copy full pilot report calls finishDemoGuide, app unlocks.' },
              { route: '/demo/privacy', check: 'Privacy page loads cleanly.' },
              { route: '/call/mock', check: 'Setup screen loads. Demo VoIP keypad visible. "Demo κλήση" shows no-real-call notice.' },
              { route: '/cmd', check: 'AI command page loads, example chips visible (5 examples), submit enabled after input. Requires ANTHROPIC_API_KEY for real intents; 503 no_api_key when missing.' },
              { route: '/appointments', check: 'Appointment agenda loads, demo appointments visible, cancellation shows inline confirmation before any update.' },
              { route: '/customer-intake/demo-karagiannis', check: 'Pre-filled form loads with demo customer data. "Αποθήκευση στοιχείων" saves with intakeStatus: completed. Opening in a different browser shows not-found page.' },
              { route: '/api/ai/review', check: 'Returns 503 no_api_key when ANTHROPIC_API_KEY is missing. Returns AI result when key is set (POST with JSON body).' },
              { route: '/api/ai/cmd', check: 'Returns 503 no_api_key when ANTHROPIC_API_KEY is missing. POST with JSON body returns { ok: true, result } on success.' },
              { route: '/api/email/send-offer', check: 'Safe preview mode (no Resend vars): returns 503 missing_email_config, no email sent. UI shows "not configured" message.' },
            ].map(({ route, check }) => (
              <div key={route} className="flex items-start gap-3 text-xs">
                <code className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-600 whitespace-nowrap">
                  {route}
                </code>
                <span className="text-zinc-500">{check}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 space-y-1">
            <p className="text-xs font-semibold text-zinc-600">Also check after each test:</p>
            {[
              'No hydration errors in browser console.',
              'localStorage data persists after page refresh.',
              'Mobile layout: no horizontal overflow.',
              'Print offer (/offers/demo-offer-1 -> print): document fills page, no sidebar clip.',
              'Guided demo app unlock: after feedback Copy report, guide session inactive, all nav works.',
              'FloatingActionMenu: only "AI review" and "Demo κλήση" — no "Σύντομα" actions.',
              'FloatingActionMenu hidden when guided demo is active.',
              'Dashboard smart cards (3) open action sheets without page navigation.',
              'Action sheets close with × button or backdrop tap.',
              'Task card "Περισσότερα" expands/collapses without overflow on mobile.',
              'PageHelp "Τι βλέπω εδώ;" toggles on /dashboard, /tasks, /call/mock.',
              'Demo VoIP keypad on /call/mock clearly says "Στο MVP δεν γίνεται πραγματική κλήση."',
              '"Demo κλήση" button shows disclaimer, not a fake connected/answered state.',
              'Native tel: link (if shown) labelled as "Άνοιγμα native κλήσης (συσκευή)", not in-app VoIP.',
              'Mobile bottom nav: 5 visible items (Αρχική, Πελάτες, AI, Ραντεβού, Περισσότερα). Περισσότερα opens sheet with Tasks, Προσφορές, Κλήσεις, Ρυθμίσεις, Demo.',
              'No native dialogs: window.confirm, confirm(), window.alert, alert() return zero grep matches across src/. Destructive actions (delete, merge, CSV import, demo exit) use inline confirmation panels.',
            ].map((c) => (
              <p key={c} className="flex items-start gap-1.5 text-xs text-zinc-500">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                {c}
              </p>
            ))}
          </div>
        </div>
      </Section>

      {/* Step 111: Pilot readiness checklist */}
      <Section title="Pilot Readiness Checklist (5-10 users)">
        <PilotChecklist />
      </Section>

      {/* Disclaimer */}
      <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
        <p className="text-xs text-amber-700">
          Internal use only. This report does not constitute legal advice. Do not share with customers or use to claim production readiness.
        </p>
      </div>

      <div className="flex gap-3">
        <Link href="/demo" className="text-sm text-indigo-600 hover:text-indigo-700">
          ← Demo οδηγός
        </Link>
        <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-700">
          Ρυθμίσεις
        </Link>
      </div>
    </div>
  );
}
