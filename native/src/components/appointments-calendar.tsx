// Google-calendar-style day view for the native Ραντεβού screen: a week strip to
// pick a day, then that day's appointments laid out by hour. Parity with the web
// CalendarDayView. Tapping an appointment calls onSelect (opens the customer).

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { todayYMD } from '@/lib/format';
import type { Task } from '@/lib/types';

const WD_SHORT = ['Κυ', 'Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα']; // getDay(): 0 = Sunday
const WD_LONG = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 … 21:00

export function AppointmentsCalendar({
  appointments,
  names,
  onSelect,
}: {
  appointments: Task[];
  names: Record<string, string>;
  onSelect: (t: Task) => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const todayStr = todayYMD();
  const [selected, setSelected] = useState(todayStr);

  const weekDays = useMemo(() => {
    const d = new Date(`${selected}T00:00:00`);
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(monday);
      x.setDate(monday.getDate() + i);
      return x;
    });
  }, [selected]);

  const countFor = (s: string) => appointments.filter((a) => a.dueDate === s).length;
  const dayAppts = useMemo(() => appointments.filter((a) => a.dueDate === selected), [appointments, selected]);
  const apptHour = (t: Task) => parseInt((t.dueTime ?? '').split(':')[0] || '-1', 10);
  const timed = dayAppts
    .filter((a) => !!a.dueTime)
    .sort((a, b) => (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
  const within = timed.filter((t) => apptHour(t) >= 7 && apptHour(t) <= 21);
  const overflow = [
    ...dayAppts.filter((a) => !a.dueTime),
    ...timed.filter((t) => apptHour(t) < 7 || apptHour(t) > 21),
  ];

  const shiftWeek = (delta: number) => {
    const d = new Date(`${selected}T00:00:00`);
    d.setDate(d.getDate() + delta * 7);
    setSelected(ymd(d));
  };

  const selDate = new Date(`${selected}T00:00:00`);
  const headerLabel = `${WD_LONG[selDate.getDay()]} ${selDate.getDate()} ${MONTHS[selDate.getMonth()]}`;

  const Block = ({ task }: { task: Task }) => {
    const name = task.customerId ? names[task.customerId] : undefined;
    return (
      <Pressable onPress={() => onSelect(task)} style={({ pressed }) => [styles.block, pressed && styles.pressed]}>
        <View style={styles.blockTop}>
          {task.dueTime ? <ThemedText style={styles.blockTime}>{task.dueTime}</ThemedText> : null}
          <ThemedText type="smallBold" style={styles.blockTitle} numberOfLines={1}>{task.title}</ThemedText>
        </View>
        {name ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{name}</ThemedText> : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.fill}>
      {/* Week navigator */}
      <View style={styles.nav}>
        <Pressable onPress={() => shiftWeek(-1)} hitSlop={8} style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.navArrow}>‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{headerLabel}</ThemedText>
        <Pressable onPress={() => shiftWeek(1)} hitSlop={8} style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.navArrow}>›</ThemedText>
        </Pressable>
      </View>

      {/* Day chips */}
      <View style={styles.week}>
        {weekDays.map((d) => {
          const s = ymd(d);
          const isSel = s === selected;
          const isToday = s === todayStr;
          const n = countFor(s);
          return (
            <Pressable
              key={s}
              onPress={() => setSelected(s)}
              style={[styles.chip, isSel && styles.chipSel, !isSel && isToday && styles.chipToday]}>
              <ThemedText style={[styles.chipDow, isSel && styles.chipTextSel]}>{WD_SHORT[d.getDay()]}</ThemedText>
              <ThemedText style={[styles.chipNum, isSel && styles.chipTextSel]}>{d.getDate()}</ThemedText>
              <View style={[styles.chipDot, n > 0 ? (isSel ? styles.chipDotSel : styles.chipDotOn) : null]} />
            </Pressable>
          );
        })}
      </View>

      {selected !== todayStr ? (
        <Pressable onPress={() => setSelected(todayStr)} hitSlop={6} style={styles.todayBtn}>
          <ThemedText type="small" style={styles.todayBtnText}>→ Σήμερα</ThemedText>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {overflow.length > 0 ? (
          <View style={styles.overflow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.overflowLabel}>ΧΩΡΙΣ ΩΡΑ</ThemedText>
            {overflow.map((t) => <Block key={t.id} task={t} />)}
          </View>
        ) : null}

        <View style={styles.grid}>
          {HOURS.map((h) => {
            const items = within.filter((t) => apptHour(t) === h);
            return (
              <View key={h} style={styles.hourRow}>
                <ThemedText style={styles.hourLabel}>{pad(h)}:00</ThemedText>
                <View style={styles.hourItems}>
                  {items.map((t) => <Block key={t.id} task={t} />)}
                </View>
              </View>
            );
          })}
        </View>

        {dayAppts.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={styles.empty}>Δεν υπάρχουν ραντεβού αυτή τη μέρα.</ThemedText>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  navArrow: { color: Brand.primary, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  week: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.four },
  chip: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.two, borderRadius: 14, backgroundColor: c.surface },
  chipSel: { backgroundColor: Brand.primary },
  chipToday: { borderWidth: 1, borderColor: Brand.primary },
  chipDow: { fontSize: 10, color: c.textSecondary },
  chipNum: { fontSize: 16, fontWeight: '800', color: c.text, lineHeight: 18 },
  chipTextSel: { color: '#FFFFFF' },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent', marginTop: 2 },
  chipDotOn: { backgroundColor: Brand.primary },
  chipDotSel: { backgroundColor: '#FFFFFF' },
  todayBtn: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  todayBtnText: { color: Brand.primary, fontWeight: '700' },
  scroll: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.six },
  overflow: { gap: Spacing.two, marginBottom: Spacing.three },
  overflowLabel: { letterSpacing: 0.6 },
  grid: { borderRadius: 18, backgroundColor: c.card, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
  hourRow: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 6, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.border },
  hourLabel: { width: 44, color: c.textSecondary, fontSize: 12, paddingTop: 6 },
  hourItems: { flex: 1, gap: 6, paddingVertical: 2 },
  block: { borderLeftWidth: 4, borderLeftColor: Brand.primary, backgroundColor: Brand.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  blockTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockTime: { color: Brand.primary, fontWeight: '800', fontSize: 12 },
  blockTitle: { flex: 1, color: Brand.navy },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  pressed: { opacity: 0.7 },
});
