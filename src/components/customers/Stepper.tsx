'use client';

// Process Stepper for an Έργο (work folder). The 5 steps map to the
// work_folders.step smallint (0..4) and mirror WORK_FOLDER_STEPS in
// src/lib/server/work-folders.ts — keep the two in sync. Rendered on the
// technician folder detail and (Stage 4) the public portal so both show the
// same Διαδικασία.

export const ERGO_STEPS = ['Επαφή', 'Προσφορά', 'Πληρωμή', 'Ραντεβού', 'Τέλος'] as const;

function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const i = Math.trunc(step);
  return i < 0 ? 0 : i > ERGO_STEPS.length - 1 ? ERGO_STEPS.length - 1 : i;
}

/** Compact one-line caption, e.g. «Βήμα 3/5 · Πληρωμή» (for cards). */
export function ergoStepCaption(step: number): string {
  const cur = clampStep(step);
  return `Βήμα ${cur + 1}/${ERGO_STEPS.length} · ${ERGO_STEPS[cur]}`;
}

export default function Stepper({ step }: { step: number }) {
  const cur = clampStep(step);
  return (
    <div className="grid grid-cols-5 gap-1">
      {ERGO_STEPS.map((label, i) => {
        const state = i < cur ? 'done' : i === cur ? 'now' : 'todo';
        return (
          <div key={label} className="flex flex-col items-center gap-1">
            <div
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition',
                state === 'todo'
                  ? 'bg-zinc-200 text-zinc-500 dark:bg-white/10 dark:text-zinc-400'
                  : 'bg-indigo-600 text-white',
                state === 'now' ? 'ring-2 ring-indigo-200 dark:ring-indigo-500/40' : '',
              ].join(' ')}
            >
              {state === 'done' ? '✓' : i + 1}
            </div>
            <span
              className={`text-center text-[9px] leading-tight ${
                state === 'todo' ? 'text-zinc-400 dark:text-zinc-500' : 'font-semibold text-zinc-700 dark:text-zinc-200'
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
