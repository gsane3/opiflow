import { Stack } from 'expo-router';

import { Brand } from '@/constants/theme';

export default function CustomersLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: Brand.primary,
        headerBackButtonDisplayMode: 'minimal',
        // #2: edge-swipe back must work everywhere. fullScreenGestureEnabled makes
        // the WHOLE screen width start the iOS back-swipe (not just the 20px edge),
        // even on screens with headerShown:false that draw their own header.
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* The customer screen is profile-first and draws its own header; the native
          push transition (slide from the right + swipe-back) stays. */}
      <Stack.Screen name="[id]/index" options={{ headerShown: false }} />
      {/* Chat-first project «Διαδικασία» — pushed full-screen route. */}
      <Stack.Screen name="[id]/project/[folderId]" options={{ headerShown: false }} />
    </Stack>
  );
}
