'use client';

import { useState } from 'react';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

interface Props {
  displayName: string;
  callTypeLabel: string;
  duration: number;
  onEndCall: () => void;
}

export default function MockCallScreen({
  displayName,
  callTypeLabel,
  duration,
  onEndCall,
}: Props) {
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  return (
    <div className="mx-auto max-w-sm px-4 py-6 space-y-4">
      {/* Mock notice */}
      <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 text-center">
        Demo κλήση. Δεν γίνεται πραγματική τηλεφωνική κλήση ή ηχογράφηση στο MVP.
      </div>

      {/* Call card */}
      <div className="rounded-2xl bg-zinc-800 p-6 text-center space-y-5">
        {/* Avatar */}
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-700 text-2xl font-bold text-zinc-300">
            {displayName.charAt(0).toUpperCase()}
          </div>
        </div>

        {/* Name + type */}
        <div>
          <p className="text-lg font-semibold text-white">{displayName}</p>
          <p className="mt-0.5 text-sm text-zinc-400">{callTypeLabel}</p>
        </div>

        {/* Timer */}
        <p className="text-3xl font-mono font-light text-white tracking-widest">
          {formatDuration(duration)}
        </p>

        {/* Mock recording badge */}
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/60 px-3 py-1 text-xs font-medium text-red-300">
            <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
            Demo ηχογράφηση
          </span>
        </div>

        {/* Mute + Speaker controls */}
        <div className="flex justify-center gap-6">
          <button
            type="button"
            onClick={() => setMuted((v) => !v)}
            title="Mute (mock — χωρίς πραγματικό ήχο)"
            className={`flex flex-col items-center gap-1 rounded-xl px-4 py-3 text-xs transition ${
              muted
                ? 'bg-zinc-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              {muted ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              )}
            </svg>
            {muted ? 'Unmute' : 'Mute'}
          </button>

          <button
            type="button"
            onClick={() => setSpeakerOn((v) => !v)}
            title="Speaker (mock — χωρίς πραγματικό ήχο)"
            className={`flex flex-col items-center gap-1 rounded-xl px-4 py-3 text-xs transition ${
              speakerOn
                ? 'bg-zinc-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
            </svg>
            Speaker
          </button>
        </div>

        {/* End call */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onEndCall}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700 active:bg-red-800"
            aria-label="Τέλος κλήσης"
          >
            <svg className="h-7 w-7 rotate-[135deg]" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-zinc-500">Τέλος κλήσης</p>
      </div>
    </div>
  );
}
