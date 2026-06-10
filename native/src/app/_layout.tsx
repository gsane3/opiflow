import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { Brand } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Gate />
      </ThemeProvider>
    </AuthProvider>
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
    (async () => {
      try {
        const { registerForIncoming } = await import('@/lib/twilio');
        if (!cancelled) await registerForIncoming();
      } catch {
        // non-fatal: the user can retry from Ρυθμίσεις → «Επανασύνδεση τηλεφώνου»
      }
    })();
    return () => {
      cancelled = true;
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

  return <AppTabs />;
}
