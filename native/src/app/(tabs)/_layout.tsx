import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { GlassTabBar } from '@/components/glass-tab-bar';

// The 4 primary tabs. The secondary screens (tasks/appointments/offers/stats/
// search/cmd) live OUTSIDE this group, as screens of the ROOT Stack (app/_layout),
// so opening them is a native push with edge-swipe-back — #2 "go back everywhere".
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false }}>
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
    </Tabs>
  );
}
