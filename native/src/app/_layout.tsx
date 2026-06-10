import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
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

// Auth gate: show a spinner while restoring the session, the login screen when
// signed out, and the native tab navigator (which mounts index/explore) when in.
function Gate() {
  const { session, loading } = useAuth();

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
