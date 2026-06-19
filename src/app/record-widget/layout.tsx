import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Keep this WebView-only recorder out of search indexes — it is loaded inside the
// native app, not meant to be a public landing page. (The page itself is a client
// component, so the noindex metadata lives here in a server-component layout.)
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RecordWidgetLayout({ children }: { children: ReactNode }) {
  return children;
}
