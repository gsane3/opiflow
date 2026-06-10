import { Stack } from 'expo-router';

import { Brand } from '@/constants/theme';

export default function CustomersLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: Brand.primary, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* Messenger-style chat + profile pages draw their own headers; the native
          push transition (slide from the right + swipe-back) stays. */}
      <Stack.Screen name="[id]/index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]/info" options={{ headerShown: false }} />
    </Stack>
  );
}
