'use client';

export default function MockWorkspacePanel() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-zinc-900">Ομάδα και ρόλοι</h2>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          Σύντομα
        </span>
      </div>
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-5 py-6 text-center">
        <p className="text-sm text-zinc-500">
          Ομάδα και ρόλοι θα ενεργοποιηθούν σε επόμενο βήμα.
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Δεν υπάρχει πρόσκληση, κοινή χρήση ή διαχείριση δικαιωμάτων σε αυτή τη φάση.
        </p>
      </div>
    </section>
  );
}
