import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, useColorScheme, View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { Brand } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { registerForIncoming } from '@/lib/twilio';

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
// native tabs when in. On native + signed in, also register for incoming calls
// (binds the VoIP push token to Twilio so the phone rings when locked/closed).
function Gate() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (session && Platform.OS !== 'web') {
      void registerForIncoming();
    }
  }, [session]);

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
