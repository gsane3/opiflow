// Voice dictation for the AI command assistant — records ON THE PHONE via the
// HTTPS /cmd-widget page in a WebView (same approach as the disclosure recorder:
// native audio libs crash because Twilio Voice owns the AVAudioSession — see memory
// native-no-expo-audio). The widget posts the clip back; we send it to
// /api/ai/transcribe and hand the text to the parent to fill the command box.

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiPost } from '@/lib/api';

// Canonical www host (the apex 308-redirects to www, which the originWhitelist would refuse).
const CMD_WIDGET_URL = 'https://www.opiflow.ai/cmd-widget';

export default function VoiceCommandRecorder({
  visible,
  onClose,
  onTranscribed,
}: {
  visible: boolean;
  onClose: () => void;
  onTranscribed: (text: string) => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [transcribing, setTranscribing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  function close() {
    setTranscribing(false);
    setLoadFailed(false);
    onClose();
  }

  async function onMessage(e: WebViewMessageEvent) {
    let msg: { type?: string; audio?: string } | null = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type !== 'cmd_audio' || typeof msg.audio !== 'string') return;
    setTranscribing(true);
    try {
      const r = await apiPost<{ ok?: boolean; text?: string }>('/api/ai/transcribe', { audio: msg.audio });
      const text = (r?.text ?? '').trim();
      if (r?.ok && text) {
        onTranscribed(text);
        close();
      } else {
        setTranscribing(false);
        Alert.alert('Φωνή', 'Δεν αναγνωρίστηκε ομιλία. Δοκίμασε ξανά.');
      }
    } catch {
      setTranscribing(false);
      Alert.alert('Σφάλμα', 'Η μεταγραφή απέτυχε. Δοκίμασε ξανά.');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      {/* Plain View + explicit inset padding (not SafeAreaView): a Modal renders
          in a detached window, so we apply the root-measured top inset directly
          with a floor so the close button is ALWAYS reachable. */}
      <View style={[styles.fill, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.header}>
          <Pressable onPress={close} hitSlop={12} style={styles.close} accessibilityLabel="Κλείσιμο">
            <Ionicons name="close" size={28} color={Brand.primary} />
          </Pressable>
          <ThemedText type="smallBold" style={styles.title}>Φωνητική εντολή</ThemedText>
          <View style={styles.spacer} />
        </View>
        {loadFailed ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={40} color={c.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>
              Δεν φόρτωσε η φωνητική εντολή. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.
            </ThemedText>
            <Pressable onPress={close} style={styles.errorBtn}>
              <ThemedText type="smallBold" style={{ color: Brand.primary }}>Κλείσιμο</ThemedText>
            </Pressable>
          </View>
        ) : (
          <WebView
            source={{ uri: CMD_WIDGET_URL }}
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
        {transcribing ? (
          <View style={styles.overlay}>
            <ActivityIndicator color={Brand.primary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.overlayText}>Μεταγραφή…</ThemedText>
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
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  overlayText: { marginTop: 8 },
});
