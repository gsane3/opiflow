import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';

import { AiSheetProvider } from '@/components/ai-sheet';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { Brand } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeModeProvider } from '@/lib/theme-mode';
import { getIncomingState } from '@/lib/twilio-state';

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <AuthProvider>
        <ThemedNavigation />
      </AuthProvider>
    </ThemeModeProvider>
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

    // Re-register when the app returns to the foreground after a failed
    // registration (cold launch offline, token hiccup) — the phone must ring.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && getIncomingState().state === 'error') {
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

  return (
    <AiSheetProvider>
      <AppTabs />
    </AiSheetProvider>
  );
}
