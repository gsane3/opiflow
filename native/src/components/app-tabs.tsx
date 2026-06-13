import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// Stable expo-router Tabs (works in release on Expo SDK 54; replaces the SDK-56
// unstable NativeTabs). Cross-platform — no separate .web variant needed.
export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Αρχική', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Πελάτες',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
          // Reset the inner stack when leaving the tab, so tapping «Πελάτες»
          // always lands on the list (not the last-open customer).
          popToTopOnBlur: true,
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{ title: 'Κλήσεις', tabBarIcon: ({ color, size }) => <Ionicons name="call" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Ρυθμίσεις', tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} /> }}
      />

      {/* Secondary screens — reachable from the Αρχική dashboard / header, hidden
          from the tab bar (mirrors the web, which also has only 4 nav tabs). */}
      <Tabs.Screen name="tasks" options={{ href: null }} />
      <Tabs.Screen name="appointments" options={{ href: null }} />
      <Tabs.Screen name="offers" options={{ href: null }} />
      <Tabs.Screen name="stats" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
