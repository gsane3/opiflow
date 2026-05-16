'use client';

import { useState } from 'react';
import Link from 'next/link';

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
  { area: 'Email delivery', mvpState: 'Copy-to-clipboard draft only', productionNeed: 'Transactional email provider (Postmark, SES)', priority: 'medium' },
  { area: 'Backup / restore', mvpState: 'Local JSON download/upload', productionNeed: 'Cloud backup with versioning', priority: 'medium' },
  { area: 'Team / multi-user', mvpState: 'Single user, no roles', productionNeed: 'Team workspaces, role-based access', priority: 'medium' },
  { area: 'Audit logging', mvpState: 'None', productionNeed: 'Immutable action log per record', priority: 'medium' },
  { area: 'GDPR consent', mvpState: 'No consent flows', productionNeed: 'Consent collection, opt-out, data export', priority: 'high' },
  { area: 'Data encryption', mvpState: 'None (plaintext localStorage)', productionNeed: 'Encryption at rest and in transit', priority: 'high' },
  { area: 'Offer e-signature', mvpState: 'Demo acceptance link only', productionNeed: 'Real e-signature or PDF with timestamp', priority: 'medium' },
  { area: 'AI API key', mvpState: 'Optional env var, falls back to demo', productionNeed: 'Server-side key management, rate limiting', priority: 'medium' },
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
  { id: 'apikey', label: 'API key ρυθμισμένο ή demo fallback αποδεκτό', note: 'Χωρίς API key: demo αποτέλεσμα στο AI review.' },
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
        <p className="text-xs text-zinc-500">{doneCount} / {total} ολοκληρωμένα</p>
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

export default function ProductionReadinessPage() {
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
              { n: 5, text: 'Email offer delivery. Removes manual copy-paste friction for offers.' },
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
