// In-app voice recorder for the call-recording disclosure — records ON THE PHONE.
//
// Native audio libraries (expo-audio etc.) crash the app because Twilio Voice owns
// the iOS AVAudioSession (see memory native-no-expo-audio). Instead we load the
// HTTPS /record-widget page in a WebView: getUserMedia works there (a real secure
// context, unlike inline HTML), and the WebView's capture session is separate from
// Twilio's and only activates while recording (no active call) — so no launch crash.
// The page posts the recorded clip back via postMessage; we upload it with the
// user's existing session (the page itself needs no auth).

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiPut } from '@/lib/api';

// Use the canonical www host directly: the apex (opiflow.ai) 308-redirects to www,
// and the WebView's originWhitelist would otherwise refuse the redirected page.
const RECORD_URL = 'https://www.opiflow.ai/record-widget';

export default function DisclosureRecorderModal({
  visible, onClose,
}: {
  visible: boolean;
  onClose: (saved: boolean) => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  function close(saved: boolean) {
    setSaving(false);
    setLoadFailed(false);
    onClose(saved);
  }

  async function onMessage(e: WebViewMessageEvent) {
    let msg: { type?: string; audio?: string } | null = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type !== 'disclosure' || typeof msg.audio !== 'string') return;
    setSaving(true);
    try {
      // The clip is a base64 data URL up to ~1.4MB; on cellular this can take well
      // over the default request timeout, so give this one call a long timeout.
      await apiPut('/api/businesses/me/disclosure-audio', { audio: msg.audio }, { timeoutMs: 60_000 });
      close(true);
    } catch {
      setSaving(false);
      Alert.alert('Σφάλμα', 'Δεν αποθηκεύτηκε το μήνυμα. Δοκίμασε ξανά.');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => close(false)}>
      {/* Plain View + explicit inset padding (not SafeAreaView): a Modal renders
          in a detached window, so we apply the root-measured top inset directly
          with a floor so the close button is ALWAYS reachable. */}
      <View style={[styles.fill, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.header}>
          <Pressable onPress={() => close(false)} hitSlop={12} style={styles.close} accessibilityLabel="Κλείσιμο">
            <Ionicons name="close" size={28} color={Brand.primary} />
          </Pressable>
          <ThemedText type="smallBold" style={styles.title}>Μήνυμα ηχογράφησης</ThemedText>
          <View style={styles.spacer} />
        </View>
        {loadFailed ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={40} color={c.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>
              Δεν φόρτωσε ο ηχογράφος. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.
            </ThemedText>
            <Pressable onPress={() => close(false)} style={styles.errorBtn}>
              <ThemedText type="smallBold" style={{ color: Brand.primary }}>Κλείσιμο</ThemedText>
            </Pressable>
          </View>
        ) : (
          <WebView
            source={{ uri: RECORD_URL }}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="grant"
            onPermissionRequest={(event: { grant: (resources: string[]) => void; resources: string[] }) => { event.grant(event.resources); }}
            originWhitelist={['https://www.opiflow.ai/*', 'https://opiflow.ai/*']}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color={Brand.primary} />
              </View>
            )}
            onError={() => setLoadFailed(true)}
            onHttpError={() => setLoadFailed(true)}
            style={styles.fill}
          />
        )}
        {saving ? (
          <View style={styles.savingOverlay}>
            <ActivityIndicator color={Brand.primary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.savingText}>Αποθήκευση…</ThemedText>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.two, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderFaint },
  close: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  spacer: { width: 44 },
  title: { flex: 1, textAlign: 'center', color: c.text },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.five },
  errorText: { textAlign: 'center' },
  errorBtn: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  savingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  savingText: { marginTop: 8 },
});
