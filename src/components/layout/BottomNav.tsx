'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Floating glass tab bar (Opiflow iOS redesign). Five slots with the AI
// assistant as a raised gradient FAB in the CENTER, exactly like the prototype:
//   Κλήσεις · Αρχική · [AI] · Πελάτες · Ρυθμίσεις
// Glassmorphism (blur + saturate + inset top line), 26px radius, float shadow,
// active tab gets a water-blue tint pill. Mobile only (desktop uses the sidebar).

function iconCls(active: boolean): string {
  return `h-6 w-6 ${active ? 'text-indigo-600' : 'text-zinc-400 dark:text-zinc-500'}`;
}

type NavItem = { href: string; label: string; icon: (active: boolean) => React.ReactNode };

const PHONE = (a: boolean) => (
  <svg className={iconCls(a)} fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
  </svg>
);
const HOME = (a: boolean) => (
  <svg className={iconCls(a)} fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
);
const USERS = (a: boolean) => (
  <svg className={iconCls(a)} fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
  </svg>
);
const GEAR = (a: boolean) => (
  <svg className={iconCls(a)} fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

const LEFT: NavItem[] = [
  { href: '/calls', label: 'Κλήσεις', icon: PHONE },
  { href: '/dashboard', label: 'Αρχική', icon: HOME },
];
const RIGHT: NavItem[] = [
  { href: '/customers', label: 'Πελάτες', icon: USERS },
  { href: '/settings', label: 'Ρυθμίσεις', icon: GEAR },
];

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li className="flex-1">
      <Link
        href={item.href}
        className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
          active ? 'text-indigo-600' : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
        }`}
      >
        <span className="relative flex items-center justify-center transition active:scale-95">
          {active && <span className="absolute inset-0 -z-10 -m-1.5 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15" aria-hidden="true" />}
          {item.icon(active)}
        </span>
        <span>{item.label}</span>
      </Link>
    </li>
  );
}

export default function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 h-[66px] rounded-[26px] border border-zinc-200/70 bg-white/75 shadow-[0_2px_6px_rgba(17,39,59,0.08),0_18px_40px_rgba(17,39,59,0.16)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-[#122130]/80 md:hidden">
      <ul className="flex h-full items-center">
        {LEFT.map((item) => (
          <Tab key={item.href} item={item} active={isActive(item.href)} />
        ))}

        {/* Center AI FAB — raised gradient circle, exactly like the prototype. */}
        <li className="flex flex-1 justify-center">
          <Link href="/cmd" aria-label="AI βοηθός" className="-mt-9 flex flex-col items-center gap-1">
            <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-brand-gradient text-white ring-4 ring-white shadow-[0_8px_20px_rgba(42,134,197,0.42)] transition active:scale-95 dark:ring-[#122130]">
              <svg className="h-7 w-7" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
              </svg>
            </span>
            <span className="text-[11px] font-semibold text-indigo-600">AI</span>
          </Link>
        </li>

        {RIGHT.map((item) => (
          <Tab key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </ul>
    </nav>
  );
}
