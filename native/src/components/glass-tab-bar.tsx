// Floating glass tab bar with a raised center AI FAB (redesign signature).
// Replaces the default expo-router tab bar. Order: Κλήσεις · Αρχική · [AI] ·
// Πελάτες · Ρυθμίσεις. The AI FAB pushes the /cmd screen.

import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, BrandGradient, Shadow } from '@/constants/theme';

type TabItem = { name: string; label: string; icon: keyof typeof Ionicons.glyphMap };

const LEFT: TabItem[] = [
  { name: 'index', label: 'Αρχική', icon: 'home' },
  { name: 'calls', label: 'Κλήσεις', icon: 'call' },
];
const RIGHT: TabItem[] = [
  { name: 'customers', label: 'Πελάτες', icon: 'people' },
  { name: 'settings', label: 'Ρυθμίσεις', icon: 'settings' },
];

export function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentName = state.routes[state.index]?.name;

  // Hide the floating bar on pushed detail screens (customer chat/profile have
  // their own bottom composer + a back header — full-screen, no tab bar).
  const nestedName = getFocusedRouteNameFromRoute(state.routes[state.index]);
  if (nestedName && nestedName.includes('[id]')) return null;

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (currentName !== name && !event.defaultPrevented) navigation.navigate(name);
  }

  const renderTab = (t: TabItem) => {
    const on = currentName === t.name;
    return (
      <Pressable key={t.name} onPress={() => go(t.name)} style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && styles.pressed]}>
        <Ionicons name={t.icon} size={22} color={on ? Brand.primary : Brand.slate} />
        <ThemedText style={[styles.label, { color: on ? Brand.primary : Brand.slate }]}>{t.label}</ThemedText>
      </Pressable>
    );
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: insets.bottom ? insets.bottom - 4 : 16 }]}>
      <View style={[styles.barShadow, Shadow.float]}>
        <BlurView intensity={45} tint="light" style={styles.bar}>
          <View style={styles.glassOverlay} pointerEvents="none" />
          {LEFT.map(renderTab)}
          <View style={styles.centerSlot} />
          {RIGHT.map(renderTab)}
        </BlurView>
      </View>

      {/* Raised AI FAB, centered above the bar */}
      <Pressable onPress={() => router.push('/cmd' as never)} style={({ pressed }) => [styles.fabWrap, pressed && styles.fabPressed]}>
        <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fab}>
          <Ionicons name="sparkles" size={24} color="#FFFFFF" />
        </LinearGradient>
        <ThemedText style={styles.aiLabel}>AI</ThemedText>
      </Pressable>
    </View>
  );
}

const BAR_H = 64;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, bottom: 0, alignItems: 'stretch' },
  barShadow: { borderRadius: 26 },
  bar: {
    height: BAR_H,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(17,39,59,0.08)',
  },
  glassOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.94)' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: '100%', borderRadius: 18 },
  tabOn: { backgroundColor: Brand.primarySoft },
  label: { fontSize: 11, fontWeight: '600' },
  centerSlot: { width: 64 },
  fabWrap: { position: 'absolute', alignSelf: 'center', bottom: BAR_H - 16, alignItems: 'center', gap: 2 },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: Brand.primary,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  aiLabel: { fontSize: 11, fontWeight: '800', color: Brand.primary, letterSpacing: 0.4 },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.94 }] },
  pressed: { opacity: 0.6 },
});
