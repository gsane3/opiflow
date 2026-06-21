import type { Metadata } from 'next';

// Loaded only inside the native app's WebView for voice dictation — keep it out of
// search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CmdWidgetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
