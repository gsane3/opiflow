import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signInWithProvider, type SocialProvider } from '@/lib/social-auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export function LoginScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);

  async function social(provider: SocialProvider) {
    if (!isSupabaseConfigured) {
      setError('Λείπει το EXPO_PUBLIC_SUPABASE_ANON_KEY (native/.env).');
      return;
    }
    setError(null);
    setInfo(null);
    setSocialBusy(provider);
    const res = await signInWithProvider(provider);
    setSocialBusy(null);
    // Success → AuthProvider.onAuthStateChange picks up the session and the app
    // navigates itself; only surface real (non-cancel) failures.
    if (!res.ok && !res.cancelled) setError(res.error ?? 'Η σύνδεση δεν ολοκληρώθηκε.');
  }

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
              placeholderTextColor={c.textFaint}
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
              placeholderTextColor={c.textFaint}
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

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <ThemedText type="small" themeColor="textSecondary">ή</ThemedText>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              onPress={() => void social('google')}
              disabled={!!socialBusy}
              style={({ pressed }) => [styles.social, pressed && styles.buttonPressed]}>
              {socialBusy === 'google' ? (
                <ActivityIndicator color={c.text} />
              ) : (
                <>
                  <Ionicons name="logo-google" size={18} color="#EA4335" />
                  <ThemedText style={styles.socialText}>Συνέχεια με Google</ThemedText>
                </>
              )}
            </Pressable>

            {Platform.OS === 'ios' ? (
              <Pressable
                onPress={() => void social('apple')}
                disabled={!!socialBusy}
                style={({ pressed }) => [styles.social, styles.socialApple, pressed && styles.buttonPressed]}>
                {socialBusy === 'apple' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={18} color="#FFFFFF" />
                    <ThemedText style={styles.socialTextApple}>Συνέχεια με Apple</ThemedText>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
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
    borderColor: c.border,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: c.text,
    backgroundColor: c.inputBg,
  },
  error: { color: '#D14343' },
  info: { color: '#1B8A4C' },
  link: { color: Brand.primary, fontWeight: '600' },
  linkRow: { alignItems: 'center', paddingVertical: Spacing.one },
  registerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.one },
  button: { height: 52, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Brand.onPrimary, fontSize: 16, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginVertical: Spacing.one },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
  social: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  socialApple: { backgroundColor: '#000000', borderColor: '#000000' },
  socialText: { color: c.text, fontSize: 15, fontWeight: '700' },
  socialTextApple: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
