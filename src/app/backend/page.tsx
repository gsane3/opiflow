import Link from 'next/link';

const LINKS = [
  {
    href: '/register',
    title: 'Δημιουργία backend λογαριασμού',
    description: 'Δοκιμή Supabase sign up.',
  },
  {
    href: '/login/backend',
    title: 'Σύνδεση backend λογαριασμού',
    description: 'Δοκιμή Supabase sign in και logout.',
  },
  {
    href: '/onboarding/backend',
    title: 'Backend onboarding test',
    description: 'Δημιουργία ή εντοπισμός business μέσω POST /api/businesses.',
  },
  {
    href: '/business/backend',
    title: 'Backend business test',
    description: 'Ανάγνωση business μέσω GET /api/businesses/me.',
  },
  {
    href: '/communications/backend',
    title: 'Backend communications test',
    description: 'Read-only PBX call viewer through GET /api/communications.',
  },
  {
    href: '/auth/confirm',
    title: 'Backend email confirmation',
    description: 'Χειρισμός Supabase confirmation callback.',
  },
];

export default function BackendHubPage() {
  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8 mb-4">
          <h1 className="text-2xl font-bold text-zinc-900 mb-1">Backend test hub</h1>
          <p className="text-sm text-zinc-500 mb-2">
            Συγκεντρώνει τις standalone backend σελίδες για Supabase Auth και business API. Δεν αντικαθιστά ακόμα το MVP app.
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Το MVP παραμένει localStorage. Αυτές οι σελίδες είναι μόνο για backend δοκιμές.
          </p>
        </div>

        <div className="space-y-2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 px-6 py-4 hover:ring-indigo-300 hover:shadow-md transition-shadow"
            >
              <p className="text-sm font-semibold text-indigo-600">{link.title}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{link.description}</p>
            </Link>
          ))}

          <Link
            href="/demo"
            className="block bg-zinc-100 rounded-2xl px-6 py-4 hover:bg-zinc-200 transition-colors"
          >
            <p className="text-sm font-semibold text-zinc-700">Πίσω στο demo MVP</p>
            <p className="text-xs text-zinc-500 mt-0.5">Το υπάρχον localStorage demo παραμένει ξεχωριστό.</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
