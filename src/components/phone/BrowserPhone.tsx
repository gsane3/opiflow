'use client';

// BrowserPhone - JsSIP softphone for inbound and outbound calls.
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

export interface CallEndedEvent {
  direction: 'inbound' | 'outbound';
  status: 'completed' | 'failed';
  phone: string | null;
  reason?: string | null;
}

export interface BrowserPhoneProps {
  ready: boolean;
  wssUrl?: string;
  sipUsername?: string;
  sipPassword?: string;
  sipRealm?: string;
  disabledReason?: string;
  /** Called once when a session ends (completed) or fails (failed). Best-effort. */
  onCallEnded?: (event: CallEndedEvent) => void;
  /** External dial target. BrowserPhone dials immediately if already registered. */
  pendingDialTarget?: string | null;
  /** Called after pendingDialTarget is consumed (dialed or rejected). Parent should set pendingDialTarget to null. */
  onDialConsumed?: () => void;
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
  | 'calling'
  | 'in_call';

const STATE_LABELS: Record<PhoneState, string> = {
  not_configured: 'Μη ρυθμισμένο',
  disconnected: 'Αποσυνδεδεμένο',
  connecting: 'Σύνδεση...',
  registered: 'Συνδεδεμένο',
  registration_failed: 'Αποτυχία σύνδεσης',
  incoming_call: 'Εισερχόμενη κλήση',
  calling: 'Κλήση εξερχόμενη...',
  in_call: 'Σε κλήση',
};

// JsSIP objects are typed loosely because the package types may not be
// installed yet. Replace with proper imports once confirmed stable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Normalize a raw phone number string to a dialable E.164 Greek number.
// Returns null when the input cannot be resolved to a recognized format.
function normalizePhoneForSip(raw: string): string | null {
  // Strip whitespace, dashes, parentheses, dots.
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return null;
}

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
  onCallEnded,
  pendingDialTarget,
  onDialConsumed,
}: BrowserPhoneProps) {
  const [phoneState, setPhoneState] = useState<PhoneState>(
    ready ? 'disconnected' : 'not_configured'
  );
  const [callerInfo, setCallerInfo] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [outboundInput, setOutboundInput] = useState('');

  // phoneStateRef lets JsSIP event handlers read current state without
  // stale closure captures. Always keep in sync with phoneState.
  const phoneStateRef = useRef<PhoneState>(ready ? 'disconnected' : 'not_configured');

  const uaRef = useRef<Loose>(null);
  const sessionRef = useRef<Loose>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // realmRef persists the resolved SIP realm after handleConnect completes
  // so that handleDial can use it without prop access inside callbacks.
  const realmRef = useRef<string>('');

  // wiredSessionsRef tracks sessions whose event handlers have already been
  // attached. wireSession is idempotent: a second call for the same session
  // is a no-op, preventing duplicate peerconnection/track listeners.
  const wiredSessionsRef = useRef<WeakSet<object>>(new WeakSet());

  // Tracks the direction and phone of the current session so that wireSession
  // callbacks can read them after callerInfo state has been cleared.
  const sessionDirectionRef = useRef<'inbound' | 'outbound'>('inbound');
  const sessionPhoneRef = useRef<string | null>(null);

  // Tracks sessions that have already fired onCallEnded to prevent duplicates.
  const calledBackSessionsRef = useRef<WeakSet<object>>(new WeakSet());

  // Stable ref for the onCallEnded prop. Kept current via a dedicated effect
  // so wireSession closures always call the latest version without adding
  // onCallEnded to wireSession's dependency array (which would re-attach all
  // session handlers on every parent render).
  const onCallEndedRef = useRef(onCallEnded);

  // Stable ref for the onDialConsumed prop.
  const onDialConsumedRef = useRef(onDialConsumed);

  // Tracks the last pendingDialTarget that was consumed to prevent double-dialing
  // in React StrictMode and to allow the same number to be dialed again after
  // the parent resets pendingDialTarget to null.
  const consumedDialTargetRef = useRef<string | null>(null);

  // Helper: update both state and ref atomically.
  const transition = useCallback((next: PhoneState) => {
    phoneStateRef.current = next;
    setPhoneState(next);
  }, []);

  // Keep onCallEndedRef current whenever the prop changes.
  useEffect(() => {
    onCallEndedRef.current = onCallEnded;
  }, [onCallEnded]);

  // Keep onDialConsumedRef current whenever the prop changes.
  useEffect(() => {
    onDialConsumedRef.current = onDialConsumed;
  }, [onDialConsumed]);

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
  // Shared session event wiring.
  // Attaches peerconnection/ended/failed handlers to any session (inbound or
  // outbound). Called after sessionRef.current is assigned.
  // ---------------------------------------------------------------------------

  const wireSession = useCallback((session: Loose) => {
    // Idempotency guard: never attach handlers to the same session twice.
    if (wiredSessionsRef.current.has(session as object)) return;
    wiredSessionsRef.current.add(session as object);

    // One stable track listener per session, reused across both the
    // peerconnection event and the direct-PC fallback below.
    // Using a named reference ensures addEventListener deduplicates correctly.
    const onTrack = (evt: RTCTrackEvent) => {
      if (audioRef.current && evt.streams[0]) {
        audioRef.current.srcObject = evt.streams[0];
        // Play may need a prior user gesture; failures are silent.
        audioRef.current.play().catch(() => { /* autoplay blocked */ });
      }
    };

    const attachToPC = (pc: RTCPeerConnection) => {
      pc.addEventListener('track', onTrack);
    };

    // Primary path: JsSIP fires 'peerconnection' when the RTCPeerConnection
    // is created. Reliable for both inbound and outbound.
    session.on(
      'peerconnection',
      (pcData: { peerconnection: RTCPeerConnection }) => {
        attachToPC(pcData.peerconnection);
      }
    );

    // Fallback path for outbound calls: ua.call() creates the RTCPeerConnection
    // synchronously, so 'peerconnection' may have already fired before
    // wireSession is called from handleDial. Attach directly if available.
    const existingPc =
      (session.connection as RTCPeerConnection | null | undefined) ??
      (session._connection as RTCPeerConnection | null | undefined) ??
      null;
    if (existingPc) {
      attachToPC(existingPc);
    }

    session.on('confirmed', () => {
      // Call was answered (outbound or inbound answered via answer()).
      setStatusMessage(null);
      transition('in_call');
    });

    session.on('ended', () => {
      // Fire onCallEnded exactly once per session.
      if (!calledBackSessionsRef.current.has(session as object)) {
        calledBackSessionsRef.current.add(session as object);
        onCallEndedRef.current?.({
          direction: sessionDirectionRef.current,
          status: 'completed',
          phone: sessionPhoneRef.current,
        });
      }
      sessionRef.current = null;
      setCallerInfo(null);
      setOutboundInput('');
      transition('registered');
    });

    session.on('failed', (e: { cause?: string }) => {
      // Fire onCallEnded exactly once per session.
      if (!calledBackSessionsRef.current.has(session as object)) {
        calledBackSessionsRef.current.add(session as object);
        onCallEndedRef.current?.({
          direction: sessionDirectionRef.current,
          status: 'failed',
          phone: sessionPhoneRef.current,
          reason: e?.cause ?? null,
        });
      }
      sessionRef.current = null;
      setCallerInfo(null);
      const cause = e?.cause ?? null;
      setStatusMessage(
        cause ? `Η κλήση απέτυχε: ${cause}` : 'Η κλήση απέτυχε.'
      );
      // Return to registered so the status message is visible with the dial input.
      transition('registered');
    });
  }, [transition]);

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
    setOutboundInput('');
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
      cur === 'calling' ||
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

    // Persist the resolved realm so handleDial can use it later.
    realmRef.current = realm;

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
      if (c === 'in_call' || c === 'incoming_call' || c === 'calling') return;
      transition('disconnected');
    });

    ua.on('newRTCSession', (data: { session: Loose; request: Loose }) => {
      const newSession: Loose = data.session;
      const isOutbound = newSession.direction === 'outgoing';

      // For outbound sessions, sessionRef was set by handleDial just before
      // ua.call() returned. The event fires immediately after, so
      // sessionRef.current already points to this session. Do not treat it
      // as a busy conflict -- check identity rather than mere existence.
      if (sessionRef.current && sessionRef.current !== newSession) {
        // A different session is already active. Reject the newcomer.
        try {
          newSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
        } catch { /* ignore */ }
        return;
      }

      if (isOutbound) {
        // Outbound: session was already stored and state set by handleDial.
        // Just wire the shared handlers.
        wireSession(newSession);
        return;
      }

      // Inbound path (unchanged behavior).
      if (sessionRef.current) {
        // A session was active but it was not this one (caught above).
        // This branch is unreachable; kept for safety.
        try {
          newSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
        } catch { /* ignore */ }
        return;
      }

      sessionRef.current = newSession;

      // Display the caller URI user part only, not the full URI.
      const callerUser =
        (data.request?.from?.uri?.user as string | undefined) ?? null;
      // Record direction and phone before wiring so ended/failed can read them.
      sessionDirectionRef.current = 'inbound';
      sessionPhoneRef.current = callerUser;
      setCallerInfo(callerUser);
      transition('incoming_call');

      wireSession(newSession);
    });

    uaRef.current = ua;
    ua.start();
  }, [ready, wssUrl, sipUsername, sipPassword, sipRealm, transition, wireSession]);

  // ---------------------------------------------------------------------------
  // Dial outbound number.
  // ---------------------------------------------------------------------------

  // Core dial logic shared by the internal input button and the pendingDialTarget effect.
  const dialRawNumber = useCallback((rawNumber: string) => {
    if (phoneStateRef.current !== 'registered') return;
    const ua = uaRef.current;
    if (!ua) return;

    const normalized = normalizePhoneForSip(rawNumber);
    if (!normalized) {
      setStatusMessage('Μη έγκυρος αριθμός.');
      return;
    }

    setStatusMessage(null);

    const realm = realmRef.current || 'sip';
    const target = `sip:${normalized}@${realm}`;

    try {
      const session: Loose = ua.call(target, {
        mediaConstraints: { audio: true, video: false },
      });
      // Wire handlers immediately, before newRTCSession fires, so that the
      // peerconnection/track listener is in place even if the RTCPeerConnection
      // was already created synchronously inside ua.call().
      sessionRef.current = session;
      // Record direction and phone before wiring so ended/failed can read them.
      sessionDirectionRef.current = 'outbound';
      sessionPhoneRef.current = normalized;
      wireSession(session);
      setCallerInfo(normalized);
      transition('calling');
    } catch {
      setStatusMessage('Αποτυχία κλήσης. Δοκίμασε ξανά.');
    }
  }, [transition, wireSession]);

  const handleDial = useCallback(() => {
    dialRawNumber(outboundInput);
  }, [outboundInput, dialRawNumber]);

  // Consume external pendingDialTarget. Dials immediately when registered;
  // otherwise shows a clear Greek status and calls onDialConsumed to clear the prop.
  useEffect(() => {
    if (!pendingDialTarget) {
      // Reset so the same number can be dialed again after parent clears the prop.
      consumedDialTargetRef.current = null;
      return;
    }
    // StrictMode guard: skip if this exact value was already consumed this cycle.
    if (pendingDialTarget === consumedDialTargetRef.current) return;
    consumedDialTargetRef.current = pendingDialTarget;

    const cur = phoneStateRef.current;
    if (cur === 'in_call' || cur === 'incoming_call' || cur === 'calling') {
      setStatusMessage('Υπάρχει ήδη ενεργή κλήση.');
      onDialConsumedRef.current?.();
      return;
    }
    if (cur !== 'registered') {
      setStatusMessage('Σύνδεσε πρώτα το τηλέφωνο.');
      onDialConsumedRef.current?.();
      return;
    }
    dialRawNumber(pendingDialTarget);
    onDialConsumedRef.current?.();
  }, [pendingDialTarget, dialRawNumber]);

  // ---------------------------------------------------------------------------
  // Answer incoming call (audio only).
  // ---------------------------------------------------------------------------

  const handleAnswer = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.answer({ mediaConstraints: { audio: true, video: false } });
      // State transitions to in_call via the confirmed event in wireSession.
      // Resume audio if autoplay was blocked before the user gesture.
      if (audioRef.current) {
        audioRef.current.play().catch(() => { /* ignore */ });
      }
    } catch {
      setStatusMessage('Αποτυχία απάντησης κλήσης. Δοκίμασε ξανά.');
    }
  }, []);

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
  // Hang up active call (inbound or outbound).
  // ---------------------------------------------------------------------------

  const handleHangUp = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.terminate();
    } catch { /* ignore */ }
    sessionRef.current = null;
    setCallerInfo(null);
    setOutboundInput('');
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
      : phoneState === 'connecting' || phoneState === 'calling'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-zinc-100 text-zinc-500 ring-zinc-200';

  const isActive =
    phoneState === 'registered' ||
    phoneState === 'in_call' ||
    phoneState === 'incoming_call' ||
    phoneState === 'calling';

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
                Σύνδεσε το app για να λαμβάνεις και να κάνεις κλήσεις.
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
                Έτοιμο. Μπορείς να δεχτείς ή να κάνεις κλήση.
              </p>

              {/* Outbound dial row */}
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="tel"
                  value={outboundInput}
                  onChange={(e) => {
                    setOutboundInput(e.target.value);
                    setStatusMessage(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && outboundInput.trim()) handleDial();
                  }}
                  placeholder="+30..."
                  className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
                />
                <button
                  type="button"
                  onClick={handleDial}
                  disabled={!outboundInput.trim()}
                  className="shrink-0 rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Κλήση
                </button>
              </div>

              {statusMessage && (
                <p className="mt-1.5 text-xs text-red-500">{statusMessage}</p>
              )}

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

          {/* calling -- outbound ringing */}
          {phoneState === 'calling' && (
            <>
              <p className="mt-0.5 text-xs text-zinc-400">
                Κλήση προς{' '}
                <span className="font-medium text-zinc-700">
                  {callerInfo ?? outboundInput}
                </span>
              </p>
              <button
                type="button"
                onClick={handleHangUp}
                className="mt-2 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600"
              >
                Ακύρωση κλήσης
              </button>
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
