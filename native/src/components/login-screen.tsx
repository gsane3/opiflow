import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
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

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function signIn() {
    if (!isSupabaseConfigured) {
      setError('Λείπει το EXPO_PUBLIC_SUPABASE_ANON_KEY (native/.env).');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError('Λάθος email ή κωδικός. Δοκίμασε ξανά.');
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
            <Pressable
              onPress={signIn}
              disabled={!canSubmit}
              style={({ pressed }) => [styles.button, !canSubmit && styles.buttonDisabled, pressed && styles.buttonPressed]}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.buttonText}>Σύνδεση</ThemedText>}
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
  logoMark: { color: Brand.onPrimary, fontSize: 36, fontWeight: '800' },
  title: { color: Brand.primary },
  sub: { textAlign: 'center' },
  form: { gap: Spacing.three },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D8DEE6',
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: '#0A1120',
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#D14343' },
  button: { height: 52, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: { backgroundColor: Brand.primaryPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Brand.onPrimary, fontSize: 16, fontWeight: '700' },
});
