// Shared UI primitives — bottom-sheet modal, inputs, buttons, chips, rows.
// Light theme only (the product is light-only, like the web app).

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, BrandGradient, Shadow, Spacing } from '@/constants/theme';

export function SheetModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <View style={styles.sheet}>
            <View style={styles.head}>
              <ThemedText type="smallBold" style={styles.title}>
                {title}
              </ThemedText>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color="#6B7585" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  onFocus,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
  onFocus?: () => void;
}) {
  return (
    <View style={styles.inputBlock}>
      {label ? (
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9AA4B2"
        keyboardType={keyboardType}
        multiline={multiline}
        onFocus={onFocus}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'outline';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.btn,
        tone === 'primary' && Shadow.card,
        tone === 'danger' && styles.btnDanger,
        tone === 'outline' && styles.btnOutline,
        (busy || disabled) && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {tone === 'primary' ? (
        <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : null}
      {busy ? (
        <ActivityIndicator color={tone === 'outline' ? Brand.primary : '#FFFFFF'} />
      ) : (
        <ThemedText style={[styles.btnText, tone === 'outline' && styles.btnTextOutline]}>{label}</ThemedText>
      )}
    </Pressable>
  );
}

/** Single-select chips row (status, channel, source, ...). */
export function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.chip, value === o.key && styles.chipActive]}>
          <ThemedText type="small" style={value === o.key ? styles.chipActiveText : undefined}>
            {o.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/** Collapsible section card (info panel / settings). */
export function Section({
  title,
  count,
  children,
  initiallyOpen = false,
  right,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  initiallyOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.sectionHead}>
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          {title}
          {typeof count === 'number' ? ` (${count})` : ''}
        </ThemedText>
        <View style={styles.sectionRight}>
          {right}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#9AA4B2" />
        </View>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

/** Tappable list row inside sections (offer / appointment rows). */
export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      <View style={styles.listRowBody}>
        <ThemedText type="small" numberOfLines={1} style={styles.listRowTitle}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {right ? <ThemedText type="smallBold">{right}</ThemedText> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color="#9AA4B2" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,17,32,0.45)', justifyContent: 'flex-end' },
  kav: { width: '100%' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  title: { fontSize: 17, color: '#11273B' },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three },

  inputBlock: { gap: 4 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8DEE6',
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 16,
    color: '#11273B',
    backgroundColor: '#FFFFFF',
  },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },

  btn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
    overflow: 'hidden',
  },
  btnDanger: { backgroundColor: '#D14343' },
  btnOutline: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D8DEE6' },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  btnTextOutline: { color: Brand.primary },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#D8DEE6', backgroundColor: '#FFFFFF' },
  chipActive: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  chipActiveText: { color: '#FFFFFF', fontWeight: '700' },

  section: { backgroundColor: '#F7F9FB', borderRadius: 16, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.three },
  sectionTitle: { fontSize: 15, color: '#11273B' },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: '#FFFFFF', borderRadius: 12, padding: Spacing.three },
  listRowBody: { flex: 1, gap: 2 },
  listRowTitle: { color: '#11273B', fontWeight: '600' },

  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
