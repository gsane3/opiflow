import { Stack } from 'expo-router';

import { Brand } from '@/constants/theme';

export default function CustomersLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: Brand.primary, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* The customer screen is profile-first and draws its own header; the native
          push transition (slide from the right + swipe-back) stays. */}
      <Stack.Screen name="[id]/index" options={{ headerShown: false }} />
    </Stack>
  );
}
