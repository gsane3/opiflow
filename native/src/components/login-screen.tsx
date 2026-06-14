import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function forgotPassword() {
    const e = email.trim();
    if (!e) {
      setError('Γράψε πρώτα το email σου για να σου στείλουμε σύνδεσμο επαναφοράς.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(e, {
      redirectTo: 'https://www.opiflow.ai/auth/reset',
    });
    setBusy(false);
    if (err) setError('Δεν στάλθηκε email. Δοκίμασε ξανά.');
    else setInfo('Σου στείλαμε email για επαναφορά κωδικού.');
  }

  async function signIn() {
    if (!isSupabaseConfigured) {
      setError('Λείπει το EXPO_PUBLIC_SUPABASE_ANON_KEY (native/.env).');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      // Don't tell an offline user their password is wrong — that path ends in
      // a pointless password reset.
      const code = (err as { code?: string }).code;
      const status = (err as { status?: number }).status;
      const isBadCredentials = code === 'invalid_credentials' || status === 400;
      setError(
        isBadCredentials
          ? 'Λάθος email ή κωδικός. Δοκίμασε ξανά.'
          : 'Πρόβλημα σύνδεσης — έλεγξε το internet και δοκίμασε ξανά.',
      );
    }
    setBusy(false);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <View style={styles.header}>
            <View style={styles.logo}>
              <ThemedText style={styles.logoMark}>O</ThemedText>
            </View>
            <ThemedText type="title" style={styles.title}>
              Opiflow
            </ThemedText>
            <ThemedText type="small" style={styles.tagline}>
              {Brand.tagline}
            </ThemedText>
            <ThemedText type="default" themeColor="textSecondary" style={styles.sub}>
              Σύνδεση στον λογαριασμό σου
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#9AA4B2"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Κωδικός"
              placeholderTextColor="#9AA4B2"
              secureTextEntry
              onSubmitEditing={() => canSubmit && signIn()}
              style={styles.input}
            />
            {error ? (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}
            {info ? (
              <ThemedText type="small" style={styles.info}>
                {info}
              </ThemedText>
            ) : null}
            <Pressable
              onPress={signIn}
              disabled={!canSubmit}
              style={({ pressed }) => [styles.button, !canSubmit && styles.buttonDisabled, pressed && styles.buttonPressed]}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.buttonText}>Σύνδεση</ThemedText>}
            </Pressable>

            <Pressable onPress={() => void forgotPassword()} disabled={busy} hitSlop={8} style={styles.linkRow}>
              <ThemedText type="small" style={styles.link}>Ξέχασες τον κωδικό;</ThemedText>
            </Pressable>

            <Pressable onPress={() => void Linking.openURL('https://www.opiflow.ai/register')} hitSlop={8} style={styles.registerRow}>
              <ThemedText type="small" themeColor="textSecondary">Δεν έχεις λογαριασμό; </ThemedText>
              <ThemedText type="small" style={styles.link}>Εγγραφή</ThemedText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  kav: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.four, gap: Spacing.five },
  header: { alignItems: 'center', gap: Spacing.three },
  logo: { width: 72, height: 72, borderRadius: 20, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  logoMark: { color: Brand.onPrimary, fontSize: 36, lineHeight: 44, fontWeight: '800' },
  title: { color: Brand.primary },
  tagline: { color: Brand.slate, letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 11 },
  sub: { textAlign: 'center' },
  form: { gap: Spacing.three },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D8DEE6',
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: '#11273B',
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#D14343' },
  info: { color: '#1B8A4C' },
  link: { color: Brand.primary, fontWeight: '600' },
  linkRow: { alignItems: 'center', paddingVertical: Spacing.one },
  registerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.one },
  button: { height: 52, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: { backgroundColor: Brand.primaryPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Brand.onPrimary, fontSize: 16, fontWeight: '700' },
});
