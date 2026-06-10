import { Stack } from 'expo-router';

import { Brand } from '@/constants/theme';

export default function CustomersLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: Brand.primary, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Πελάτης' }} />
    </Stack>
  );
}
