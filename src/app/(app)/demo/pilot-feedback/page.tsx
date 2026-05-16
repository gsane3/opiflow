'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import KnownLimitationsBox from '@/components/common/KnownLimitationsBox';
import { loadState } from '@/lib/storage';
import DemoStepBanner from '@/components/common/DemoStepBanner';
import GuidedDemoBanner from '@/components/common/GuidedDemoBanner';
import { finishDemoGuide } from '@/lib/demo-guide-session';
import { buildDataHealthReport } from '@/lib/data-health';

// ── Step 113: Feedback questions ──────────────────────────────────────────────
const QUESTIONS = [
  { id: 'understood', label: 'Τι κατάλαβες ότι κάνει το app;' },
  { id: 'confused', label: 'Πού μπερδεύτηκες;' },
  { id: 'after_call', label: 'Θα το χρησιμοποιούσες μετά από πραγματική κλήση;' },
  { id: 'useful', label: 'Ποιο feature σου φάνηκε πιο χρήσιμο;' },
  { id: 'missing', label: 'Τι θα έλειπε για να το χρησιμοποιήσεις καθημερινά;' },
  { id: 'price', label: 'Πόσα θα πλήρωνες τον μήνα; (ευρώ)' },
];

function buildFeedbackText(answers: Record<string, string>): string {
  const lines = QUESTIONS.map((q) => `${q.label}\n${answers[q.id] || '—'}`).join('\n\n');
  return `=== Pilot Feedback yorgos.ai ===\n\n${lines}`;
}

export default function PilotFeedbackPage() {
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(QUESTIONS.map((q) => [q.id, '']))
  );
  const [feedbackCopied, setFeedbackCopied] = useState(false);

  // ── Step 117: Bug report ─────────────────────────────────────────────────
  const [bugReport, setBugReport] = useState('');
  const [bugCopied, setBugCopied] = useState(false);

  // Steps 146+147: local counts and health for report/snapshot
  const [localCounts, setLocalCounts] = useState({ customers: 0, tasks: 0, offers: 0, calls: 0, communications: 0 });
  const [healthIssueCount, setHealthIssueCount] = useState(0);
  const [reportCopied, setReportCopied] = useState(false);
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [guideFeedbackCompleted, setGuideFeedbackCompleted] = useState(false);

  useEffect(() => {
    const state = loadState();
    const report = buildDataHealthReport(state);
    const timer = window.setTimeout(() => {
      setLocalCounts(report.counts);
      setHealthIssueCount(report.issues.length);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function copyText(text: string, onDone: () => void) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: create temp textarea
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(el);
    }
    onDone();
  }

  function handleCopyFeedback() {
    void copyText(buildFeedbackText(answers), () => {
      setFeedbackCopied(true);
      setTimeout(() => setFeedbackCopied(false), 2500);
    });
  }

  function handleCopyBug() {
    void copyText(bugReport, () => {
      setBugCopied(true);
      setTimeout(() => setBugCopied(false), 2500);
    });
  }

  // Step 146: full pilot report (answers + counts, no PII)
  function buildFullReport(): string {
    const now = new Date().toLocaleString('el-GR');
    const feedbackLines = QUESTIONS.map(q => `${q.label}\n${answers[q.id] || '—'}`).join('\n\n');
    return `=== Pilot Report yorgos.ai ===
Ημερομηνία: ${now}

=== Feedback ===
${feedbackLines}

=== Τοπικά δεδομένα (αριθμοί μόνο, χωρίς PII) ===
Πελάτες: ${localCounts.customers}
Tasks: ${localCounts.tasks}
Προσφορές: ${localCounts.offers}
Κλήσεις: ${localCounts.calls}
Επικοινωνίες: ${localCounts.communications}
Θέματα data health: ${healthIssueCount}

=== Δήλωση ===
Demo μόνο. Τοπική αποθήκευση. Δεν αποτελεί παραγωγικό σύστημα.
Χωρίς cloud sync, χωρίς VoIP, χωρίς SMS/email provider, χωρίς νομικό έλεγχο.`;
  }

  // Step 147: support snapshot (browser info + counts, no PII)
  function buildSupportSnapshot(): string {
    const now = new Date().toISOString();
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A';
    const vw = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'N/A';
    const route = typeof window !== 'undefined' ? window.location.pathname : '/demo/pilot-feedback';
    return `=== Support Snapshot yorgos.ai ===
Timestamp: ${now}
Route: ${route}
Viewport: ${vw}
Browser: ${ua}
Counts: customers=${localCounts.customers}, tasks=${localCounts.tasks}, offers=${localCounts.offers}, calls=${localCounts.calls}, comms=${localCounts.communications}
Health issues: ${healthIssueCount}
Demo/MVP only. No customer PII included.`;
  }

  function handleCopyReport() {
    void copyText(buildFullReport(), () => {
      setReportCopied(true);
      setGuideFeedbackCompleted(true);
      finishDemoGuide();
      setTimeout(() => setReportCopied(false), 2500);
    });
  }

  function handleCopySnapshot() {
    void copyText(buildSupportSnapshot(), () => {
      setSnapshotCopied(true);
      setTimeout(() => setSnapshotCopied(false), 2500);
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Pilot / Internal
          </span>
          <Link href="/demo" className="text-xs text-zinc-400 hover:text-zinc-600">
            ← Demo οδηγός
          </Link>
        </div>
        {/* Step 169: Demo mission final step banner */}
        <DemoStepBanner
          step="feedback"
          stepNum={8}
          title="Τελευταίο βήμα -- Feedback!"
          body="Συμπλήρωσε τις ερωτήσεις, πάτα 'Αντιγραφή πλήρους pilot report' και στείλε το στον George."
          watchLabel="Χωρίς αυτόματη αποστολή -- copy-paste μόνο."
        />
        <GuidedDemoBanner
          step="feedback"
          stepNum={7}
          title="Feedback — τελευταίο βήμα"
          whatYouSee="Ερωτήσεις αξιολόγησης, κουμπί αντιγραφής pilot report."
          whatToDo="Συμπλήρωσε τις ερωτήσεις. Πάτα 'Αντιγραφή πλήρους pilot report'. Στείλε το αποτέλεσμα χειροκίνητα."
          whyItMatters="Χωρίς αυτόματη αποστολή — copy-paste μόνο. Δεν αποστέλλεται τίποτα αυτόματα σε κανέναν."
          canManualComplete={false}
          isCompleted={guideFeedbackCompleted}
          isFinalStep={true}
        />
        <h1 className="text-xl font-bold text-zinc-900">Feedback reviewer</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Συμπλήρωσε τις ερωτήσεις — πάτα «Αντιγραφή» και στείλ&apos; το αποτέλεσμα χειροκίνητα.
          Δεν αποστέλλεται τίποτα αυτόματα.
        </p>
        {/* Step 158: Privacy note for public reviewers */}
        <div className="mt-2 rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200">
          <p className="text-xs text-zinc-500">
            Μην γράψεις ευαίσθητα πραγματικά δεδομένα στις απαντήσεις.
            Τα reports δεν περιέχουν ονόματα ή τηλέφωνα — μόνο αριθμούς.
          </p>
        </div>
      </div>

      {/* Step 113: Feedback questions */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-zinc-800">Ερωτήσεις (5-6 λεπτά)</h2>
        {QUESTIONS.map((q) => (
          <div key={q.id}>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">{q.label}</label>
            <textarea
              rows={2}
              value={answers[q.id]}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              placeholder="Απάντηση..."
              className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        ))}

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={handleCopyFeedback}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              feedbackCopied
                ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {feedbackCopied ? '✓ Αντιγράφηκε' : 'Αντιγραφή feedback'}
          </button>
          <p className="text-xs text-zinc-400">
            Αντέγραψε το κείμενο και στείλε το μέσω email ή Viber στον υπεύθυνο pilot.
          </p>

          {/* Step 146+147: full report + support snapshot */}
          <div className="flex flex-wrap gap-3 pt-2 border-t border-zinc-100">
            <button
              type="button"
              onClick={handleCopyReport}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                reportCopied
                  ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                  : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              {reportCopied ? '✓ Αντιγράφηκε' : 'Αντιγραφή πλήρους pilot report'}
            </button>
            <button
              type="button"
              onClick={handleCopySnapshot}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                snapshotCopied
                  ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                  : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              {snapshotCopied ? '✓ Αντιγράφηκε' : 'Αντιγραφή support snapshot'}
            </button>
          </div>
          <p className="text-xs text-zinc-400">
            Τα reports περιέχουν αριθμούς δεδομένων μόνο — χωρίς ονόματα, τηλέφωνα ή PII.
          </p>
        </div>
      </section>

      {/* Step 117: Support / bug report panel */}
      <section className="space-y-4 border-t border-zinc-100 pt-6">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Αναφορά προβλήματος</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Περιέγραψε το πρόβλημα. Αντέγραψε και στείλε — δεν γίνεται αυτόματη αποστολή.
          </p>
        </div>

        <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-2">
          <p className="text-xs font-semibold text-zinc-600">Τι να συμπεριλάβεις:</p>
          <ul className="space-y-1">
            {[
              'Screenshot της σελίδας που είδες το πρόβλημα.',
              'URL σελίδας (π.χ. /customers, /ai-review).',
              'Τι έκανες — τι ενέργεια ή κλικ.',
              'Τι περίμενες να γίνει.',
              'Browser και συσκευή (π.χ. Chrome / iPhone 14).',
              'Αν χρησιμοποιούσες demo ή δικά σου δεδομένα.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-zinc-600">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl bg-red-50 p-4 ring-1 ring-red-200 space-y-1.5">
          <p className="text-xs font-semibold text-red-700">Τι ΔΕΝ πρέπει να στείλεις:</p>
          <ul className="space-y-1">
            {[
              'Ευαίσθητα δεδομένα πελατών (ΑΦΜ, προσωπικά στοιχεία).',
              'Λεπτομέρειες πραγματικών κλήσεων ή ηχογραφήσεων.',
              'Οτιδήποτε δεν θα ήθελες να δει τρίτος.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-red-700">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Περιγραφή προβλήματος
          </label>
          <textarea
            rows={4}
            value={bugReport}
            onChange={(e) => setBugReport(e.target.value)}
            placeholder="Τι συνέβη; Σε ποια σελίδα; Τι έκανες; Τι περίμενες;"
            className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={handleCopyBug}
            disabled={!bugReport.trim()}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              bugCopied
                ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {bugCopied ? '✓ Αντιγράφηκε' : 'Αντιγραφή αναφοράς'}
          </button>
          <p className="text-xs text-zinc-400">
            Κάνε backup πριν ξεκινήσεις δοκιμές — τα δεδομένα αποθηκεύονται μόνο τοπικά.
          </p>
        </div>
      </section>

      <KnownLimitationsBox />

      <div className="flex flex-wrap gap-4">
        <Link href="/demo" className="text-sm text-indigo-600 hover:text-indigo-700">
          ← Demo οδηγός
        </Link>
        <Link href="/demo/production-readiness" className="text-sm text-zinc-500 hover:text-zinc-700">
          Τεχνική ετοιμότητα
        </Link>
        <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-700">
          Ρυθμίσεις / Backup
        </Link>
      </div>
    </div>
  );
}
