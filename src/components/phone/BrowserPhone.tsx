'use client';

// BrowserPhone - minimal JsSIP softphone for inbound calls.
//
// DEPENDENCY: requires jssip to be installed before building.
// George runs: npm install jssip
//
// JsSIP is imported dynamically inside the connect handler to prevent
// server-side rendering errors. The SIP password is never logged or
// rendered in the UI.

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrowserPhoneProps {
  ready: boolean;
  wssUrl?: string;
  sipUsername?: string;
  sipPassword?: string;
  sipRealm?: string;
  disabledReason?: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type PhoneState =
  | 'not_configured'
  | 'disconnected'
  | 'connecting'
  | 'registered'
  | 'registration_failed'
  | 'incoming_call'
  | 'in_call';

const STATE_LABELS: Record<PhoneState, string> = {
  not_configured: 'Μη ρυθμισμένο',
  disconnected: 'Αποσυνδεδεμένο',
  connecting: 'Σύνδεση...',
  registered: 'Συνδεδεμένο',
  registration_failed: 'Αποτυχία σύνδεσης',
  incoming_call: 'Εισερχόμενη κλήση',
  in_call: 'Σε κλήση',
};

// JsSIP objects are typed loosely because the package types may not be
// installed yet. Replace with proper imports once confirmed stable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BrowserPhone({
  ready,
  wssUrl,
  sipUsername,
  sipPassword,
  sipRealm,
  disabledReason,
}: BrowserPhoneProps) {
  const [phoneState, setPhoneState] = useState<PhoneState>(
    ready ? 'disconnected' : 'not_configured'
  );
  const [callerInfo, setCallerInfo] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // phoneStateRef lets JsSIP event handlers read current state without
  // stale closure captures. Always keep in sync with phoneState.
  const phoneStateRef = useRef<PhoneState>(ready ? 'disconnected' : 'not_configured');

  const uaRef = useRef<Loose>(null);
  const sessionRef = useRef<Loose>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Helper: update both state and ref atomically.
  const transition = useCallback((next: PhoneState) => {
    phoneStateRef.current = next;
    setPhoneState(next);
  }, []);

  // Sync not_configured / disconnected when the ready prop changes.
  // setTimeout defers the state update out of the render cycle, satisfying
  // react-hooks/set-state-in-effect. Cleanup cancels if the effect re-fires.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!ready) {
        transition('not_configured');
      } else if (phoneStateRef.current === 'not_configured') {
        transition('disconnected');
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [ready, transition]);

  // Cleanup UA and session on unmount.
  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s) { try { s.terminate(); } catch { /* ignore */ } }
      const u = uaRef.current;
      if (u) { try { u.stop(); } catch { /* ignore */ } }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Disconnect: stop UA and session, return to disconnected.
  // ---------------------------------------------------------------------------

  const stopUa = useCallback(() => {
    const s = sessionRef.current;
    if (s) {
      try { s.terminate(); } catch { /* ignore */ }
      sessionRef.current = null;
    }
    const u = uaRef.current;
    if (u) {
      try { u.stop(); } catch { /* ignore */ }
      uaRef.current = null;
    }
    setCallerInfo(null);
    setStatusMessage(null);
    transition('disconnected');
  }, [transition]);

  // ---------------------------------------------------------------------------
  // Connect: mic permission + JsSIP UA init + SIP registration.
  // ---------------------------------------------------------------------------

  const handleConnect = useCallback(async () => {
    const cur = phoneStateRef.current;
    if (
      cur === 'connecting' ||
      cur === 'registered' ||
      cur === 'incoming_call' ||
      cur === 'in_call'
    ) {
      return;
    }

    if (!ready || !wssUrl || !sipUsername || !sipPassword) {
      setStatusMessage('Τα στοιχεία σύνδεσης δεν είναι διαθέσιμα.');
      return;
    }

    setStatusMessage(null);

    // Request microphone permission before opening the WebSocket.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setStatusMessage(
        'Δεν δόθηκε άδεια μικροφώνου. Ενεργοποίησέ την από τον browser.'
      );
      return;
    }

    transition('connecting');

    // Dynamic import prevents SSR errors. Fails gracefully if jssip is absent.
    let JsSIP: Loose;
    try {
      const mod: Loose = await import('jssip');
      JsSIP = mod.default ?? mod;
    } catch {
      transition('registration_failed');
      setStatusMessage('Δεν ήταν δυνατή η φόρτωση της βιβλιοθήκης SIP.');
      return;
    }

    // Derive realm from the prop or from the WSS URL hostname.
    let realm = sipRealm ?? '';
    if (!realm) {
      try {
        realm = new URL(wssUrl).hostname;
      } catch {
        // Use the part after @ in sipUsername if present, else a fallback.
        realm = sipUsername.includes('@') ? sipUsername.split('@')[1] : 'sip';
      }
    }

    // Use the username portion only (strip domain if present).
    const userPart = sipUsername.includes('@')
      ? sipUsername.split('@')[0]
      : sipUsername;

    const socket = new JsSIP.WebSocketInterface(wssUrl);

    const ua: Loose = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${userPart}@${realm}`,
      password: sipPassword,
      register: true,
    });

    // ----- UA events -----

    ua.on('registered', () => {
      transition('registered');
      setStatusMessage(null);
    });

    ua.on('registrationFailed', (e: { cause?: string }) => {
      transition('registration_failed');
      // Cause string from JsSIP does not include credentials.
      setStatusMessage(
        `Αποτυχία εγγραφής SIP${e?.cause ? `: ${e.cause}` : ''}.`
      );
    });

    ua.on('disconnected', () => {
      // Do not overwrite an active call state on a transient transport drop.
      const c = phoneStateRef.current;
      if (c === 'in_call' || c === 'incoming_call') return;
      transition('disconnected');
    });

    ua.on('newRTCSession', (data: { session: Loose; request: Loose }) => {
      const newSession: Loose = data.session;

      // Reject if already handling a call.
      if (sessionRef.current) {
        try {
          newSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
        } catch { /* ignore */ }
        return;
      }

      // This slice handles inbound calls only.
      if (newSession.direction !== 'incoming') return;

      sessionRef.current = newSession;

      // Display the caller URI user part only, not the full URI.
      const callerUser =
        (data.request?.from?.uri?.user as string | undefined) ?? null;
      setCallerInfo(callerUser);
      transition('incoming_call');

      // Attach remote audio when the peer connection receives a track.
      newSession.on(
        'peerconnection',
        (pcData: { peerconnection: RTCPeerConnection }) => {
          pcData.peerconnection.addEventListener(
            'track',
            (evt: RTCTrackEvent) => {
              if (audioRef.current && evt.streams[0]) {
                audioRef.current.srcObject = evt.streams[0];
                // Play may be deferred to the Answer button gesture.
                audioRef.current.play().catch(() => { /* autoplay blocked */ });
              }
            }
          );
        }
      );

      newSession.on('ended', () => {
        sessionRef.current = null;
        setCallerInfo(null);
        transition('registered');
      });

      newSession.on('failed', () => {
        sessionRef.current = null;
        setCallerInfo(null);
        transition('registered');
      });
    });

    uaRef.current = ua;
    ua.start();
  }, [ready, wssUrl, sipUsername, sipPassword, sipRealm, transition]);

  // ---------------------------------------------------------------------------
  // Answer incoming call (audio only).
  // ---------------------------------------------------------------------------

  const handleAnswer = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.answer({ mediaConstraints: { audio: true, video: false } });
      transition('in_call');
      // Resume audio if autoplay was blocked before the user gesture.
      if (audioRef.current) {
        audioRef.current.play().catch(() => { /* ignore */ });
      }
    } catch {
      setStatusMessage('Αποτυχία απάντησης κλήσης. Δοκίμασε ξανά.');
    }
  }, [transition]);

  // ---------------------------------------------------------------------------
  // Decline incoming call.
  // ---------------------------------------------------------------------------

  const handleDecline = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    } catch { /* ignore */ }
    sessionRef.current = null;
    setCallerInfo(null);
    transition('registered');
  }, [transition]);

  // ---------------------------------------------------------------------------
  // Hang up active call.
  // ---------------------------------------------------------------------------

  const handleHangUp = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.terminate();
    } catch { /* ignore */ }
    sessionRef.current = null;
    setCallerInfo(null);
    transition('registered');
  }, [transition]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const stateLabel = STATE_LABELS[phoneState];

  const badgeCls =
    phoneState === 'registered'
      ? 'bg-green-50 text-green-700 ring-green-200'
      : phoneState === 'in_call' || phoneState === 'incoming_call'
      ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
      : phoneState === 'registration_failed'
      ? 'bg-red-50 text-red-700 ring-red-200'
      : phoneState === 'connecting'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-zinc-100 text-zinc-500 ring-zinc-200';

  const isActive =
    phoneState === 'registered' ||
    phoneState === 'in_call' ||
    phoneState === 'incoming_call';

  const iconBg = isActive
    ? 'bg-green-50'
    : phoneState === 'registration_failed'
    ? 'bg-red-50'
    : 'bg-indigo-50';

  const iconColor = isActive
    ? 'text-green-500'
    : phoneState === 'registration_failed'
    ? 'text-red-400'
    : 'text-indigo-500';

  return (
    <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
      {/* Remote audio stream. Hidden from view. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="flex items-start gap-3">

        {/* Status icon */}
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconBg}`}
        >
          <svg
            className={`h-5 w-5 ${iconColor}`}
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
        </div>

        {/* Content column */}
        <div className="min-w-0 flex-1">

          {/* Header row: label + badge */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-500">
              Τηλέφωνο μέσα στο app
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${badgeCls}`}
            >
              {stateLabel}
            </span>
          </div>

          {/* not_configured */}
          {phoneState === 'not_configured' && (
            <p className="mt-0.5 text-xs text-zinc-400">
              {disabledReason ?? 'Η σύνδεση τηλεφώνου δεν είναι διαθέσιμη ακόμα.'}
            </p>
          )}

          {/* disconnected */}
          {phoneState === 'disconnected' && (
            <>
              <p className="mt-0.5 text-xs text-zinc-400">
                Σύνδεσε το app για να λαμβάνεις κλήσεις.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                className="mt-2 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
              >
                Σύνδεση τηλεφώνου
              </button>
              {statusMessage && (
                <p className="mt-1.5 text-xs text-red-500">{statusMessage}</p>
              )}
            </>
          )}

          {/* connecting */}
          {phoneState === 'connecting' && (
            <p className="mt-0.5 text-xs text-zinc-400">
              Σύνδεση στο τηλεφωνικό σύστημα...
            </p>
          )}

          {/* registered */}
          {phoneState === 'registered' && (
            <>
              <p className="mt-0.5 text-xs text-zinc-400">
                Έτοιμο να λαμβάνει κλήσεις.
              </p>
              <button
                type="button"
                onClick={stopUa}
                className="mt-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Αποσύνδεση
              </button>
            </>
          )}

          {/* registration_failed */}
          {phoneState === 'registration_failed' && (
            <>
              <p className="mt-0.5 text-xs text-red-500">
                {statusMessage ?? 'Αποτυχία σύνδεσης. Δοκίμασε ξανά.'}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleConnect}
                  className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  Δοκιμή ξανά
                </button>
                <button
                  type="button"
                  onClick={stopUa}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
                >
                  Αποσύνδεση
                </button>
              </div>
            </>
          )}

          {/* incoming_call */}
          {phoneState === 'incoming_call' && (
            <>
              <p className="mt-0.5 text-xs font-medium text-zinc-700">
                {callerInfo ?? 'Εισερχόμενη κλήση'}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleAnswer}
                  className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                >
                  Απάντηση
                </button>
                <button
                  type="button"
                  onClick={handleDecline}
                  className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600"
                >
                  Απόρριψη
                </button>
              </div>
            </>
          )}

          {/* in_call */}
          {phoneState === 'in_call' && (
            <>
              <p className="mt-0.5 text-xs font-medium text-zinc-700">
                {callerInfo ?? 'Κλήση σε εξέλιξη'}
              </p>
              <button
                type="button"
                onClick={handleHangUp}
                className="mt-2 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600"
              >
                Κλείσιμο κλήσης
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
