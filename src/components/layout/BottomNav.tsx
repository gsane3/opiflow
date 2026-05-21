'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PRIMARY_ITEMS = [
  {
    href: '/dashboard',
    label: 'Αρχική',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-zinc-400'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    ),
  },
  {
    href: '/customers',
    label: 'Πελάτες',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-zinc-400'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
        />
      </svg>
    ),
  },
  {
    href: '/cmd',
    label: 'AI',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-zinc-400'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
        />
      </svg>
    ),
  },
  {
    href: '/appointments',
    label: 'Ραντεβού',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-zinc-400'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
        />
      </svg>
    ),
  },
];

const MORE_ROUTES = [
  {
    href: '/tasks',
    label: 'Tasks',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 shrink-0 ${active ? 'text-indigo-600' : 'text-zinc-500'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
    ),
  },
  {
    href: '/offers',
    label: 'Προσφορές',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 shrink-0 ${active ? 'text-indigo-600' : 'text-zinc-500'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>
    ),
  },
  {
    href: '/calls',
    label: 'Κλήσεις',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 shrink-0 ${active ? 'text-indigo-600' : 'text-zinc-500'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
        />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Ρυθμίσεις',
    icon: (active: boolean) => (
      <svg
        className={`h-5 w-5 shrink-0 ${active ? 'text-indigo-600' : 'text-zinc-500'}`}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreActive = MORE_ROUTES.some(
    (r) => pathname === r.href || pathname.startsWith(r.href + '/')
  );

  return (
    <>
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          {/* More sheet */}
          <div className="fixed bottom-16 left-0 right-0 z-50 border-t border-zinc-200 bg-white shadow-lg md:hidden">
            <ul className="divide-y divide-zinc-100">
              {MORE_ROUTES.map((route) => {
                const active =
                  pathname === route.href || pathname.startsWith(route.href + '/');
                return (
                  <li key={route.href}>
                    <Link
                      href={route.href}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-3 px-5 py-3.5 transition ${
                        active ? 'text-indigo-600' : 'text-zinc-700 hover:bg-zinc-50'
                      }`}
                    >
                      {route.icon(active)}
                      <span className="flex-1 text-sm font-medium">{route.label}</span>
                      <svg
                        className="h-4 w-4 shrink-0 text-zinc-300"
                        fill="none"
                        strokeWidth={2}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m8.25 4.5 7.5 7.5-7.5 7.5"
                        />
                      </svg>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white md:hidden">
        <ul className="flex h-16 items-center">
          {PRIMARY_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition ${
                    active ? 'text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {item.icon(active)}
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          {/* More button */}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className={`flex w-full flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition ${
                moreActive || moreOpen ? 'text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <svg
                className={`h-5 w-5 ${moreActive || moreOpen ? 'text-indigo-600' : 'text-zinc-400'}`}
                fill="none"
                strokeWidth={1.5}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
              <span>Περισσότερα</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
