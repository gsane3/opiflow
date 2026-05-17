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
  { area: 'Authentication', mvpState: 'None â€” single-user, no login', productionNeed: 'User auth (email/password or OAuth)', priority: 'high' },
  { area: 'Data storage', mvpState: 'localStorage (browser-only)', productionNeed: 'Cloud database (Postgres / Supabase)', priority: 'high' },
  { area: 'Multi-device sync', mvpState: 'Not available', productionNeed: 'Real-time sync via cloud backend', priority: 'high' },
  { area: 'VoIP / calling', mvpState: 'Demo only â€” no real calls', productionNeed: 'SIP/WebRTC provider (Twilio, Vonage)', priority: 'high' },
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
  high: 'Î¥ÏˆÎ·Î»Î®',
  medium: 'ÎœÎµÏƒÎ±Î¯Î±',
  low: 'Î§Î±Î¼Î·Î»Î®',
};

const PRIORITY_CLS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-zinc-100 text-zinc-500',
};

const PILOT_ITEMS = [
  { id: 'data', label: 'Demo Î´ÎµÎ´Î¿Î¼Î­Î½Î± Î­Ï„Î¿Î¹Î¼Î±', note: 'Î•Ï€Î±Î½Î±Ï†Î¿ÏÎ¬ Î±Ï€ÏŒ Î¡Ï…Î¸Î¼Î¯ÏƒÎµÎ¹Ï‚ > Demo ÎºÎ±Î¹ ÎµÏ€Î±Î½Î±Ï†Î¿ÏÎ¬.' },
  { id: 'backup', label: 'Backup Î´Î¿ÎºÎ¹Î¼Î±ÏƒÎ¼Î­Î½Î¿', note: 'Î›Î®ÏˆÎ· backup JSON ÎºÎ±Î¹ ÎµÏ€Î¹Î²ÎµÎ²Î±Î¯Ï‰ÏƒÎ· Ï€ÎµÏÎ¹ÎµÏ‡Î¿Î¼Î­Î½Î¿Ï….' },
  { id: 'restore', label: 'Restore Î´Î¿ÎºÎ¹Î¼Î±ÏƒÎ¼Î­Î½Î¿', note: 'Î•Ï€Î±Î½Î±Ï†Î¿ÏÎ¬ backup ÏƒÎµ Î½Î­Î¿ browser tab â€” ÎµÏ€Î¹Î²ÎµÎ²Î±Î¯Ï‰ÏƒÎ· preview.' },
  { id: 'csv', label: 'CSV ÎµÎ¹ÏƒÎ±Î³Ï‰Î³Î® / ÎµÎ¾Î±Î³Ï‰Î³Î® Î´Î¿ÎºÎ¹Î¼Î±ÏƒÎ¼Î­Î½Î±', note: 'Î•Î¾Î±Î³Ï‰Î³Î® Ï€ÎµÎ»Î±Ï„ÏŽÎ½ + ÎµÎ¹ÏƒÎ±Î³Ï‰Î³Î® ÏƒÎµ Î½Î­Î± Î»Î¯ÏƒÏ„Î±.' },
  { id: 'claims', label: 'Î”ÎµÎ½ ÎµÎ¼Ï†Î±Î½Î¯Î¶Î¿Î½Ï„Î±Î¹ fake Î¹ÏƒÏ‡Ï…ÏÎ¹ÏƒÎ¼Î¿Î¯', note: 'ÎˆÎ»ÎµÎ³Ï‡Î¿Ï‚: VoIP, SMS, cloud, Î±Ï€Î¿ÏƒÏ„Î¿Î»Î® email.' },
  { id: 'apikey', label: 'API key ÏÏ…Î¸Î¼Î¹ÏƒÎ¼Î­Î½Î¿ Î® demo fallback Î±Ï€Î¿Î´ÎµÎºÏ„ÏŒ', note: 'Î§Ï‰ÏÎ¯Ï‚ API key: demo Î±Ï€Î¿Ï„Î­Î»ÎµÏƒÎ¼Î± ÏƒÏ„Î¿ AI review.' },
  { id: 'support', label: 'Î”Î¹Î±Î´Î¹ÎºÎ±ÏƒÎ¯Î± Ï…Ï€Î¿ÏƒÏ„Î®ÏÎ¹Î¾Î·Ï‚ pilot users Î­Ï„Î¿Î¹Î¼Î·', note: 'Email / WhatsApp Î³Î¹Î± Î±Î½Î±Ï†Î¿ÏÎ¬ bugs ÎºÎ±Î¹ ÎµÏÏ‰Ï„Î®ÏƒÎµÎ¹Ï‚.' },
  { id: 'limits', label: 'Î“Î½Ï‰ÏƒÏ„Î¿Î¯ Ï€ÎµÏÎ¹Î¿ÏÎ¹ÏƒÎ¼Î¿Î¯ ÎºÎ¿Î¹Î½Î¿Ï€Î¿Î¹Î·Î¼Î­Î½Î¿Î¹', note: 'Î¤Î¿Ï€Î¹ÎºÎ® Î±Ï€Î¿Î¸Î®ÎºÎµÏ…ÏƒÎ·, Ï‡Ï‰ÏÎ¯Ï‚ sync, Ï‡Ï‰ÏÎ¯Ï‚ VoIP.' },
  { id: 'legal', label: 'ÎÎ¿Î¼Î¹ÎºÏŒÏ‚ / GDPR Î­Î»ÎµÎ³Ï‡Î¿Ï‚: Î”Î•Î Î­Ï‡ÎµÎ¹ Î³Î¯Î½ÎµÎ¹', note: 'Pilot Î¼ÏŒÎ½Î¿ â€” Î´ÎµÎ½ Ï‡ÏÎ·ÏƒÎ¹Î¼Î¿Ï€Î¿Î¹ÎµÎ¯Ï„Î±Î¹ Î³Î¹Î± Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÎ¬ Î´ÎµÎ´Î¿Î¼Î­Î½Î± Ï€Î±ÏÎ±Î³Ï‰Î³Î®Ï‚.' },
  { id: 'feedback', label: 'Î•ÏÏ‰Ï„Î®ÏƒÎµÎ¹Ï‚ feedback pilot users Î­Ï„Î¿Î¹Î¼ÎµÏ‚', note: 'Ï€.Ï‡. ÏÎ¿Î®, Ï„Î±Ï‡ÏÏ„Î·Ï„Î±, demo ÏƒÎµÎ½Î¬ÏÎ¹Î±, Î±Î½Î±Ï†Î¿ÏÎ¬ Ï€ÏÎ¿Î²Î»Î·Î¼Î¬Ï„Ï‰Î½.' },
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
          <p className="text-xs text-zinc-500">{doneCount} / {total} Î¿Î»Î¿ÎºÎ»Î·ÏÏ‰Î¼Î­Î½Î±</p>
          {doneCount > 0 && (
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
            >
              ÎšÎ±Î¸Î±ÏÎ¹ÏƒÎ¼ÏŒÏ‚
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
        Î— Î»Î¯ÏƒÏ„Î± Î´ÎµÎ½ Î±Ï€Î¿Î¸Î·ÎºÎµÏÎµÏ„Î±Î¹. Î•ÏƒÏ‰Ï„ÎµÏÎ¹ÎºÎ® Ï‡ÏÎ®ÏƒÎ· Î¼ÏŒÎ½Î¿ â€” Î´ÎµÎ½ Î±Î½Ï„Î¹ÏƒÏ„Î¿Î¹Ï‡ÎµÎ¯ ÏƒÎµ production readiness.
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
            â† Demo Î¿Î´Î·Î³ÏŒÏ‚
          </Link>
        </div>
        <h1 className="text-xl font-bold text-zinc-900">Production Readiness Gap Report</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Internal reference â€” MVP status vs. production requirements. Do not share with customers.
        </p>
      </div>

      {/* What is real in the MVP */}
      <Section title="Î¤Î¹ ÎµÎ¯Î½Î±Î¹ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÏŒ ÏƒÏ„Î¿ MVP">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
          {[
            'LocalStorage CRM: Ï€ÎµÎ»Î¬Ï„ÎµÏ‚, tasks, Ï€ÏÎ¿ÏƒÏ†Î¿ÏÎ­Ï‚, ÎºÎ»Î®ÏƒÎµÎ¹Ï‚, ÎµÏ€Î¹ÎºÎ¿Î¹Î½Ï‰Î½Î¯ÎµÏ‚.',
            'AI review Î¼Îµ Claude API â€” ÏŒÏ„Î±Î½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹ ANTHROPIC_API_KEY.',
            'CSV ÎµÎ¹ÏƒÎ±Î³Ï‰Î³Î® ÎºÎ±Î¹ ÎµÎ¾Î±Î³Ï‰Î³Î® Ï€ÎµÎ»Î±Ï„ÏŽÎ½.',
            'Backup / restore Ï„Î¿Ï€Î¹ÎºÎ¿Ï JSON.',
            'ÎˆÎ»ÎµÎ³Ï‡Î¿Ï‚ Ï…Î³ÎµÎ¯Î±Ï‚ Î´ÎµÎ´Î¿Î¼Î­Î½Ï‰Î½ Ï„Î¿Ï€Î¹ÎºÎ¬.',
            'Mobile-first UI Î¼Îµ ÎµÎ»Î»Î·Î½Î¹ÎºÏŒ copy.',
            'Î¥Ï€Î±Î³ÏŒÏÎµÏ…ÏƒÎ· Î¼Î­ÏƒÏ‰ Web Speech API (browser-native).',
            'Native tel: / sms: links Î³Î¹Î± ÎºÎ»Î®ÏƒÎ· ÎºÎ±Î¹ SMS Î±Ï€ÏŒ ÏƒÏ…ÏƒÎºÎµÏ…Î®.',
            'Î‘Î½Ï„Î¹Î³ÏÎ±Ï†Î® draft Viber / email Ï‡ÎµÎ¹ÏÎ¿ÎºÎ¯Î½Î·Ï„Î±.',
          ].map((item) => (
            <div key={item} className="flex items-start gap-2 text-sm text-zinc-700">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* What is demo/local */}
      <Section title="Î¤Î¹ ÎµÎ¯Î½Î±Î¹ demo / Ï„Î¿Ï€Î¹ÎºÏŒ Î¼ÏŒÎ½Î¿">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
          {[
            'Demo ÎºÎ»Î®ÏƒÎ· â€” Î´ÎµÎ½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹ VoIP Î® Î·Ï‡Î¿Î³ÏÎ¬Ï†Î·ÏƒÎ·.',
            'Demo Ï‡Î±Î¼Î­Î½ÎµÏ‚ ÎºÎ»Î®ÏƒÎµÎ¹Ï‚ â€” ÏƒÏ„Î±Ï„Î¹ÎºÎ¬ Î´ÎµÎ´Î¿Î¼Î­Î½Î±.',
            'SMS intake â€” demo timers, Ï‡Ï‰ÏÎ¯Ï‚ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÏŒ SMS.',
            'Provider readiness badges â€” ÏŒÎ»Î¿Î¹ Î¿Î¹ Ï€Î¬ÏÎ¿Ï‡Î¿Î¹ ÎµÎ¯Î½Î±Î¹ Demo.',
            'Cloud sync â€” Î´ÎµÎ½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹.',
            'Offer acceptance â€” demo link, Ï‡Ï‰ÏÎ¯Ï‚ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÎ® Ï…Ï€Î¿Î³ÏÎ±Ï†Î®.',
            'Multi-user / team â€” Î´ÎµÎ½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹.',
            'Audit log â€” Î´ÎµÎ½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹.',
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
            'No user authentication â€” anyone with browser access sees all data.',
            'No server-side validation â€” all data is trusted from the client.',
            'No multi-device sync â€” data exists only in one browser.',
            'No cloud backup â€” data is lost if localStorage is cleared.',
            'No audit trail â€” no record of who changed what and when.',
            'No soft-delete â€” deleted records cannot be recovered from the app.',
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
              { n: 3, text: 'VoIP integration â€” at minimum call routing and brief capture. Core product value.' },
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

      {/* Step 119: Pilot metrics dashboard */}
      <Section title="Pilot Metrics (Ï„Î¿Ï€Î¹ÎºÎ¬)">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
          <p className="text-xs text-zinc-400">
            Î¤Î¿Ï€Î¹ÎºÎ¬ Î´ÎµÎ´Î¿Î¼Î­Î½Î± Î¼ÏŒÎ½Î¿ â€” Î´ÎµÎ½ ÎµÎ¯Î½Î±Î¹ product analytics, Î´ÎµÎ½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹ tracking.
          </p>
          {counts ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Î ÎµÎ»Î¬Ï„ÎµÏ‚', value: counts.customers },
                { label: 'ÎšÎ»Î®ÏƒÎµÎ¹Ï‚ (mock)', value: counts.calls },
                { label: 'Î•Ï€Î¹ÎºÎ¿Î¹Î½Ï‰Î½Î¯ÎµÏ‚', value: counts.communications },
                { label: 'Î ÏÎ¿ÏƒÏ†Î¿ÏÎ­Ï‚', value: counts.offers },
                { label: 'Tasks Î±Î½Î¿Î¹Ï‡Ï„Î¬', value: counts.tasksOpen },
                { label: 'Tasks Î¿Î»Î¿ÎºÎ».', value: counts.tasksCompleted },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-zinc-50 px-3 py-2.5 text-center ring-1 ring-zinc-100">
                  <p className="text-lg font-bold text-zinc-900">{value}</p>
                  <p className="text-xs text-zinc-400">{label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Î¦ÏŒÏÏ„Ï‰ÏƒÎ·...</p>
          )}
          <p className="text-xs text-zinc-400">
            ÎŸÎ¹ ÎºÎ»Î®ÏƒÎµÎ¹Ï‚ ÎºÎ±Î¹ ÎµÏ€Î¹ÎºÎ¿Î¹Î½Ï‰Î½Î¯ÎµÏ‚ Ï‡ÏÎ·ÏƒÎ¹Î¼Î¿Ï€Î¿Î¹Î¿ÏÎ½Ï„Î±Î¹ Ï‰Ï‚ proxy Î³Î¹Î± AI review Ï‡ÏÎ®ÏƒÎ·.
          </p>
        </div>
      </Section>

      {/* Step 118: AI usage estimator */}
      <Section title="Î¤Î¿Ï€Î¹ÎºÎ® ÎµÎºÏ„Î¯Î¼Î·ÏƒÎ· Ï‡ÏÎ®ÏƒÎ·Ï‚">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
          <p className="text-xs text-zinc-400">
            Î•ÎºÏ„Î¯Î¼Î·ÏƒÎ· Î±Ï€ÏŒ Ï„Î¿Ï€Î¹ÎºÎ¬ Î´ÎµÎ´Î¿Î¼Î­Î½Î± â€” Î´ÎµÎ½ ÎµÎ¯Î½Î±Î¹ Ï‡ÏÎ­Ï‰ÏƒÎ·. Î”ÎµÎ½ Î³Î¯Î½ÎµÏ„Î±Î¹ tracking.
          </p>
          {counts ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-zinc-600">
                <span>Î ÎµÎ»Î¬Ï„ÎµÏ‚ ÏƒÏ„Î¿ CRM</span>
                <span className="font-semibold text-zinc-900">{counts.customers}</span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>ÎšÎ»Î®ÏƒÎµÎ¹Ï‚ / AI reviews (proxy)</span>
                <span className="font-semibold text-zinc-900">
                  {counts.calls + counts.communications}
                </span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Î ÏÎ¿ÏƒÏ†Î¿ÏÎ­Ï‚ Î´Î·Î¼Î¹Î¿Ï…ÏÎ³Î·Î¼Î­Î½ÎµÏ‚</span>
                <span className="font-semibold text-zinc-900">{counts.offers}</span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Tasks ÏƒÏ…Î½Î¿Î»Î¹ÎºÎ¬</span>
                <span className="font-semibold text-zinc-900">{counts.tasks}</span>
              </div>
              <div className="border-t border-zinc-100 pt-2 text-xs text-zinc-400">
                Î£Îµ production, Î· Ï‡ÏÎ­Ï‰ÏƒÎ· AI Î¸Î± Î²Î±ÏƒÎ¯Î¶ÎµÏ„Î±Î¹ ÏƒÎµ tokens per call â€” ÏŒÏ‡Î¹ ÏƒÎµ Î±Ï…Ï„Î¿ÏÏ‚
                Ï„Î¿Ï…Ï‚ Î±ÏÎ¹Î¸Î¼Î¿ÏÏ‚. Î‘Ï…Ï„ÏŒ ÎµÎ¯Î½Î±Î¹ rough proxy Î¼ÏŒÎ½Î¿ Î³Î¹Î± ÎµÏƒÏ‰Ï„ÎµÏÎ¹ÎºÎ® Ï‡ÏÎ®ÏƒÎ·.
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Î¦ÏŒÏÏ„Ï‰ÏƒÎ·...</p>
          )}
        </div>
      </Section>

      {/* Step 152: Known issues for pilot */}
      <Section title="Known issues Î³Î¹Î± pilot">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
          {[
            { issue: 'Î¤Î¿Ï€Î¹ÎºÎ® Î±Ï€Î¿Î¸Î®ÎºÎµÏ…ÏƒÎ·', detail: 'Î¤Î± Î´ÎµÎ´Î¿Î¼Î­Î½Î± Î¼Ï€Î¿ÏÎµÎ¯ Î½Î± Î´Î¹Î±Î³ÏÎ±Ï†Î¿ÏÎ½ Î±Î½ ÎºÎ±Î¸Î±ÏÎ¹ÏƒÏ„ÎµÎ¯ Ï„Î¿ localStorage Ï„Î¿Ï… browser.' },
            { issue: 'Demo links Î¼ÏŒÎ½Î¿ ÏƒÏ„Î¿Î½ Î¯Î´Î¹Î¿ browser', detail: 'Î¤Î¿ /offer-response/[id] Î´ÎµÎ½ Î»ÎµÎ¹Ï„Î¿Ï…ÏÎ³ÎµÎ¯ ÏƒÎµ Î¬Î»Î»Î¿ browser Î® ÏƒÏ…ÏƒÎºÎµÏ…Î®.' },
            { issue: 'Î§Ï‰ÏÎ¯Ï‚ cloud sync', detail: 'Î”ÎµÎ½ Ï…Ï€Î¬ÏÏ‡ÎµÎ¹ ÏƒÏ…Î³Ï‡ÏÎ¿Î½Î¹ÏƒÎ¼ÏŒÏ‚ Î¼ÎµÏ„Î±Î¾Ï ÏƒÏ…ÏƒÎºÎµÏ…ÏŽÎ½ Î® browser tabs.' },
            { issue: 'Î§Ï‰ÏÎ¯Ï‚ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÏŒ SMS/email', detail: 'ÎŸÎ¹ ÎµÏ€Î¹ÎºÎ¿Î¹Î½Ï‰Î½Î¯ÎµÏ‚ Î³Î¯Î½Î¿Î½Ï„Î±Î¹ Î¼ÏŒÎ½Î¿ Î¼Îµ Î±Î½Ï„Î¹Î³ÏÎ±Ï†Î® ÎºÎµÎ¹Î¼Î­Î½Î¿Ï… Î® native link (tel:/sms:).' },
            { issue: 'Î§Ï‰ÏÎ¯Ï‚ VoIP Î® Î·Ï‡Î¿Î³ÏÎ¬Ï†Î·ÏƒÎ·', detail: 'Î— demo ÎºÎ»Î®ÏƒÎ· Î´ÎµÎ½ ÏƒÏ…Î½Î´Î­ÎµÏ„Î±Î¹ Î¼Îµ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÏŒ Ï€Î¬ÏÎ¿Ï‡Î¿.' },
            { issue: 'Î§Ï‰ÏÎ¯Ï‚ Î½Î¿Î¼Î¹ÎºÏŒ / e-signature', detail: 'Î— Î±Ï€Î¿Î´Î¿Ï‡Î® Ï€ÏÎ¿ÏƒÏ†Î¿ÏÎ¬Ï‚ Î´ÎµÎ½ Î±Ï€Î¿Ï„ÎµÎ»ÎµÎ¯ Î½ÏŒÎ¼Î¹Î¼Î· Ï…Ï€Î¿Î³ÏÎ±Ï†Î®.' },
            { issue: 'Î”ÎµÎ½ ÎµÎ¯Î½Î±Î¹ production-safe', detail: 'ÎœÎ·Î½ Î±Ï€Î¿Î¸Î·ÎºÎµÏÎµÎ¹Ï‚ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÎ¬ Î´ÎµÎ´Î¿Î¼Î­Î½Î± Ï€Î±ÏÎ±Î³Ï‰Î³Î®Ï‚ ÏƒÎµ Î±Ï…Ï„ÏŒ Ï„Î¿ MVP.' },
            { issue: 'Print / export ÎµÎ¾Î±ÏÏ„Î¬Ï„Î±Î¹ Î±Ï€ÏŒ browser', detail: 'Î— ÎµÎºÏ„ÏÏ€Ï‰ÏƒÎ· Ï€ÏÎ¿ÏƒÏ†Î¿ÏÏŽÎ½ ÎµÎ¾Î±ÏÏ„Î¬Ï„Î±Î¹ Î±Ï€ÏŒ Ï„Î¹Ï‚ ÏÏ…Î¸Î¼Î¯ÏƒÎµÎ¹Ï‚ Ï„Î¿Ï… browser ÎºÎ±Î¹ OS.' },
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
              { route: '/demo (guided start)', check: 'Click "ÎžÎµÎºÎ¹Î½Î± guided demo" -> lands on /dashboard with guide=1 banner.' },
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
              { route: '/call/mock', check: 'Setup screen loads. Demo VoIP keypad visible. "Demo ÎºÎ»Î®ÏƒÎ·" shows no-real-call notice.' },
              { route: '/api/ai/review', check: 'Returns demo result without API key (POST with text).' },
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
              'Bottom nav has 5 items: Î‘ÏÏ‡Î¹ÎºÎ®, Î ÎµÎ»Î¬Ï„ÎµÏ‚, ÎšÎ»Î®ÏƒÎµÎ¹Ï‚, Tasks, Î ÏÎ¿ÏƒÏ†Î¿ÏÎ­Ï‚.',
              '/calls page loads, shows empty state when no calls, "ÎÎ­Î± ÎºÎ»Î®ÏƒÎ·" links to /call/mock.',
              'Dashboard smart cards (6) open action sheets without page navigation.',
              'Action sheets close with Ã— button or backdrop tap.',
              'Task card "Î ÎµÏÎ¹ÏƒÏƒÏŒÏ„ÎµÏÎ±" expands/collapses without overflow on mobile.',
              'PageHelp "Î¤Î¹ Î²Î»Î­Ï€Ï‰ ÎµÎ´ÏŽ;" toggles on /dashboard, /tasks, /call/mock.',
              'Demo VoIP keypad on /call/mock clearly says "Î£Ï„Î¿ MVP Î´ÎµÎ½ Î³Î¯Î½ÎµÏ„Î±Î¹ Ï€ÏÎ±Î³Î¼Î±Ï„Î¹ÎºÎ® ÎºÎ»Î®ÏƒÎ·."',
              '"Demo ÎºÎ»Î®ÏƒÎ·" button shows disclaimer, not a fake connected/answered state.',
              'Native tel: link (if shown) labelled as "Î†Î½Î¿Î¹Î³Î¼Î± native ÎºÎ»Î®ÏƒÎ·Ï‚ (ÏƒÏ…ÏƒÎºÎµÏ…Î®)", not in-app VoIP.',
              'Mobile bottom nav: exactly 4 items (Î‘ÏÏ‡Î¹ÎºÎ®, Î ÎµÎ»Î¬Ï„ÎµÏ‚, Tasks, Î ÏÎ¿ÏƒÏ†Î¿ÏÎ­Ï‚).',
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
          â† Demo Î¿Î´Î·Î³ÏŒÏ‚
        </Link>
        <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-700">
          Î¡Ï…Î¸Î¼Î¯ÏƒÎµÎ¹Ï‚
        </Link>
      </div>
    </div>
  );
}

