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
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiPut } from '@/lib/api';

const RECORD_URL = 'https://opiflow.ai/record-widget';

export default function DisclosureRecorderModal({
  visible, onClose,
}: {
  visible: boolean;
  onClose: (saved: boolean) => void;
}) {
  const c = useTheme();
  const styles = makeStyles(c);
  const [saving, setSaving] = useState(false);

  function close(saved: boolean) {
    setSaving(false);
    onClose(saved);
  }

  async function onMessage(e: WebViewMessageEvent) {
    let msg: { type?: string; audio?: string } | null = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type !== 'disclosure' || typeof msg.audio !== 'string') return;
    setSaving(true);
    try {
      await apiPut('/api/businesses/me/disclosure-audio', { audio: msg.audio });
      close(true);
    } catch {
      setSaving(false);
      Alert.alert('Σφάλμα', 'Δεν αποθηκεύτηκε το μήνυμα. Δοκίμασε ξανά.');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => close(false)}>
      <SafeAreaView edges={['top']} style={styles.fill}>
        <View style={styles.header}>
          <Pressable onPress={() => close(false)} hitSlop={10} style={styles.close}>
            <Ionicons name="close" size={26} color={Brand.primary} />
          </Pressable>
          <ThemedText type="smallBold" style={styles.title}>Μήνυμα ηχογράφησης</ThemedText>
          <View style={styles.spacer} />
        </View>
        <WebView
          source={{ uri: RECORD_URL }}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          onPermissionRequest={(event: { grant: (resources: string[]) => void; resources: string[] }) => { event.grant(event.resources); }}
          originWhitelist={['https://opiflow.ai/*']}
          style={styles.fill}
        />
        {saving ? (
          <View style={styles.savingOverlay}>
            <ActivityIndicator color={Brand.primary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.savingText}>Αποθήκευση…</ThemedText>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.two, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderFaint },
  close: { width: 32, alignItems: 'flex-start' },
  spacer: { width: 32 },
  title: { flex: 1, textAlign: 'center', color: c.text },
  savingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  savingText: { marginTop: 8 },
});
