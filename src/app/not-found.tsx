import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#F5F5F7] px-6 text-center dark:bg-[#0e1722]">
      <p className="text-6xl font-bold text-zinc-200 dark:text-zinc-700">404</p>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Η σελίδα δεν βρέθηκε</h1>
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
          Ο σύνδεσμος μπορεί να έχει λήξει ή να μην υπάρχει πια.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
      >
        Αρχική
      </Link>
    </div>
  );
}
