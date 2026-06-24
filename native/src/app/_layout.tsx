import 'react-native-gesture-handler';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AiSheetProvider } from '@/components/ai-sheet';
import AppTabs from '@/components/app-tabs';
import { IncomingCallModal } from '@/components/incoming-call-modal';
import { LoginScreen } from '@/components/login-screen';
import { NeedsSetupScreen } from '@/components/needs-setup-screen';
import { Brand } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { apiGet, ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeModeProvider } from '@/lib/theme-mode';
import { getIncomingState } from '@/lib/twilio-state';

export default function RootLayout() {
  // SafeAreaProvider + GestureHandlerRootView MUST be mounted at the true app
  // root. Without them, React Native <Modal>s (the voice/disclosure recorders,
  // the incoming-call overlay) render in a detached window where safe-area insets
  // resolve to 0 — which jammed the close «X» under the status bar and made
  // full-screen recorder modals un-closable. Mounting the provider here makes
  // useSafeAreaInsets() return real insets everywhere, including inside modals,
  // and enables gesture-handler-backed swipe-back app-wide.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <AuthProvider>
            <ThemedNavigation />
          </AuthProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Drives the navigation container theme + status-bar style from the resolved
// scheme (must live under ThemeModeProvider).
function ThemedNavigation() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Gate />
    </ThemeProvider>
  );
}

// Auth gate: spinner while restoring the session, login when signed out, the
// native tabs when in.
//
// The Twilio voice SDK must NOT be in the cold-launch require graph: loading it
// during the first ~100ms of launch (before iOS finishes bringing up the app)
// throws a native exception and aborts. So we never import it statically anywhere
// that runs at startup. Instead, the moment we have a session we dynamically load
// it and register for incoming calls — automatically, no manual tap, so the phone
// rings in the background. (Loading on-demand like this is the same path the
// outgoing dialer uses, which is verified working on device.)
function Gate() {
  const { session, loading } = useAuth();
  const userId = session?.user?.id;

  // Onboarding/activation gate (parity with the web AppShell): a signed-in user
  // with NO business (404) or a not-allowed subscription (activationAllowed
  // false) must finish setup on the website — otherwise they'd land in an empty
  // app and (for OAuth signups) never get billed. Network/5xx fails OPEN so a
  // flaky connection never bricks the app.
  const [bizState, setBizState] = useState<'checking' | 'ok' | 'needs'>('checking');
  const [recheck, setRecheck] = useState(0);
  const bizStateRef = useRef(bizState);
  bizStateRef.current = bizState;

  useEffect(() => {
    if (!userId) {
      setBizState('checking');
      return;
    }
    let cancelled = false;
    setBizState('checking');
    (async () => {
      try {
        const res = await apiGet<{ ok?: boolean; activationAllowed?: boolean }>('/api/businesses/me');
        if (!cancelled) setBizState(res?.activationAllowed ? 'ok' : 'needs');
      } catch (e) {
        if (cancelled) return;
        // 404 = no business yet → needs setup. Anything else (network/5xx) fails
        // open; a 401 already triggers sign-out in the api layer.
        setBizState(e instanceof ApiError && e.status === 404 ? 'needs' : 'ok');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, recheck]);

  // When the user returns from finishing setup on the website, re-check.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && bizStateRef.current === 'needs') setRecheck((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const retrySetup = useCallback(() => setRecheck((n) => n + 1), []);

  // CRITICAL for killed-app incoming calls (iOS PushKit): set up the VoIP push
  // registry as early as possible AND independently of login. The Twilio SDK
  // creates its PKPushRegistry only on this JS call (not in native init), so when
  // iOS relaunches a killed app for a VoIP push the lock-screen CallKit ring only
  // appears once this has run. Gating it behind auth made it run too late → the
  // call surfaced as a stale "ringing" on open instead of ringing while closed.
  // Token binding (registerForIncoming) still happens after login, below.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { initPushRegistry } = await import('@/lib/twilio');
        if (!cancelled) await initPushRegistry();
      } catch {
        // non-fatal: registerForIncoming also calls initPushRegistry after login
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const doRegister = async () => {
      try {
        const { registerForIncoming } = await import('@/lib/twilio');
        if (!cancelled) await registerForIncoming();
      } catch {
        // non-fatal: registerForIncoming retries internally; the Home banner +
        // Ρυθμίσεις → «Επανασύνδεση τηλεφώνου» cover the rest
      }
    };

    void doRegister();

    // Re-register whenever the app returns to the foreground and the device is
    // not currently registered (error, idle, or a dropped binding) — the phone
    // must ring. Idempotent on the Twilio side; a no-op when already registered.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const s = getIncomingState().state;
      if (s !== 'registered' && s !== 'registering') {
        void doRegister();
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Brand.primary} />
      </View>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (bizState === 'checking') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Brand.primary} />
      </View>
    );
  }

  if (bizState === 'needs') {
    return <NeedsSetupScreen onRetry={retrySetup} />;
  }

  return (
    <AiSheetProvider>
      <AppTabs />
      {/* Global ring/in-call overlay (B7). Renders null until a call invite arrives. */}
      <IncomingCallModal />
    </AiSheetProvider>
  );
}
