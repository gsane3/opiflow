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

// The confirmation email must land somewhere that can complete the flow on any
// device — the WEB /auth/confirm. After confirming there, the user simply signs
// in here and the Gate takes over (NeedsSetupScreen handles no-business next).
const CONFIRM_REDIRECT = 'https://www.opiflow.ai/auth/confirm';

export function LoginScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Registration submitted, email confirmation pending.
  const [awaitingVerify, setAwaitingVerify] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'busy' | 'sent'>('idle');

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    !busy &&
    (mode === 'login' || (agreed && password.length >= 6));

  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
    setInfo(null);
    setAwaitingVerify(false);
  }

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

  // In-app registration — same supabase-js flow as the web /register page.
  // With a session (email confirmation off) the Gate flips to the app on its
  // own; otherwise we show the awaiting-verify card with a resend button.
  async function signUp() {
    if (!isSupabaseConfigured) {
      setError('Λείπει το EXPO_PUBLIC_SUPABASE_ANON_KEY (native/.env).');
      return;
    }
    if (password.length < 6) {
      setError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { emailRedirectTo: CONFIRM_REDIRECT },
    });
    setBusy(false);
    if (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 429
          ? 'Πολλές προσπάθειες — δοκίμασε ξανά σε λίγο.'
          : 'Η εγγραφή δεν ολοκληρώθηκε. Έλεγξε το email και δοκίμασε ξανά.',
      );
      return;
    }
    // Existing email: Supabase returns a user with EMPTY identities and no
    // session (email-enumeration guard) — same check as the web register page.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError('Υπάρχει ήδη λογαριασμός με αυτό το email. Δοκίμασε σύνδεση.');
      return;
    }
    if (!data.session) {
      setAwaitingVerify(true);
      setResendState('idle');
    }
    // With a session the AuthProvider flips the Gate — nothing else to do.
  }

  async function resendVerification() {
    if (resendState === 'busy') return;
    setResendState('busy');
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: CONFIRM_REDIRECT },
    });
    setResendState(err ? 'idle' : 'sent');
    if (err) setError('Η επαναποστολή απέτυχε. Δοκίμασε ξανά σε λίγο.');
  }

  const isRegister = mode === 'register';

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
              {awaitingVerify
                ? 'Ένα βήμα έμεινε'
                : isRegister
                ? 'Δημιούργησε τον λογαριασμό σου'
                : 'Σύνδεση στον λογαριασμό σου'}
            </ThemedText>
          </View>

          {awaitingVerify ? (
            <View style={styles.verifyCard}>
              <Ionicons name="mail-unread" size={32} color={Brand.primary} />
              <ThemedText type="smallBold" style={styles.verifyTitle}>
                Έλεγξε το email σου
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.verifyText}>
                Στείλαμε σύνδεσμο επιβεβαίωσης στο {email.trim()}. Πάτησέ τον και μετά
                γύρνα εδώ για να συνδεθείς. Δεν ήρθε; Έλεγξε και τα ανεπιθύμητα (spam).
              </ThemedText>
              <Pressable
                onPress={() => void resendVerification()}
                disabled={resendState !== 'idle'}
                style={({ pressed }) => [styles.resendBtn, resendState !== 'idle' && styles.buttonDisabled, pressed && styles.buttonPressed]}>
                <ThemedText type="small" style={styles.link}>
                  {resendState === 'sent' ? '✓ Στάλθηκε ξανά' : resendState === 'busy' ? 'Αποστολή…' : 'Επαναποστολή email'}
                </ThemedText>
              </Pressable>
              {error ? (
                <ThemedText type="small" style={styles.error}>
                  {error}
                </ThemedText>
              ) : null}
              <Pressable onPress={() => switchMode('login')} hitSlop={8} style={styles.linkRow}>
                <ThemedText type="small" style={styles.link}>Πίσω στη σύνδεση</ThemedText>
              </Pressable>
            </View>
          ) : (
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
                placeholder={isRegister ? 'Κωδικός (τουλάχιστον 6 χαρακτήρες)' : 'Κωδικός'}
                placeholderTextColor={c.textFaint}
                secureTextEntry
                onSubmitEditing={() => canSubmit && (isRegister ? signUp() : signIn())}
                style={styles.input}
              />

              {isRegister ? (
                <Pressable onPress={() => setAgreed((v) => !v)} style={styles.termsRow} hitSlop={6}>
                  <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                    {agreed ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.termsText}>
                    Συμφωνώ με τους{' '}
                    <ThemedText
                      type="small"
                      style={styles.link}
                      onPress={() => void Linking.openURL('https://www.opiflow.ai/terms')}>
                      Όρους Χρήσης
                    </ThemedText>{' '}
                    και την{' '}
                    <ThemedText
                      type="small"
                      style={styles.link}
                      onPress={() => void Linking.openURL('https://www.opiflow.ai/privacy')}>
                      Πολιτική Απορρήτου
                    </ThemedText>
                    .
                  </ThemedText>
                </Pressable>
              ) : null}

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
                onPress={() => void (isRegister ? signUp() : signIn())}
                disabled={!canSubmit}
                style={({ pressed }) => [styles.button, !canSubmit && styles.buttonDisabled, pressed && styles.buttonPressed]}>
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.buttonText}>
                    {isRegister ? 'Δημιουργία λογαριασμού' : 'Σύνδεση'}
                  </ThemedText>
                )}
              </Pressable>

              {!isRegister ? (
                <Pressable onPress={() => void forgotPassword()} disabled={busy} hitSlop={8} style={styles.linkRow}>
                  <ThemedText type="small" style={styles.link}>Ξέχασες τον κωδικό;</ThemedText>
                </Pressable>
              ) : null}

              <Pressable onPress={() => switchMode(isRegister ? 'login' : 'register')} hitSlop={8} style={styles.registerRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {isRegister ? 'Έχεις ήδη λογαριασμό; ' : 'Δεν έχεις λογαριασμό; '}
                </ThemedText>
                <ThemedText type="small" style={styles.link}>
                  {isRegister ? 'Σύνδεση' : 'Εγγραφή'}
                </ThemedText>
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

              {isRegister ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.oauthTerms}>
                  Συνεχίζοντας με Google/Apple αποδέχεσαι τους Όρους Χρήσης.
                </ThemedText>
              ) : null}
            </View>
          )}
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
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  termsText: { flex: 1, lineHeight: 18 },
  verifyCard: {
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: c.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    padding: Spacing.four,
  },
  verifyTitle: { marginTop: Spacing.one },
  verifyText: { textAlign: 'center', lineHeight: 19 },
  resendBtn: {
    marginTop: Spacing.one,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Brand.primary,
    paddingHorizontal: Spacing.four,
    paddingVertical: 8,
  },
  oauthTerms: { textAlign: 'center', fontSize: 11 },
});
