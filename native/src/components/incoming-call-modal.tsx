// B7 — global incoming-call modal. Branded ring screen (Answer / Decline) that
// flips to an in-call view (Mute / Hang up + live timer) once answered.
//
// SDK-free: it only reads the incoming-call session from twilio-state (which
// twilio.ts populates from the Twilio CallInvite / Call events). So this can be
// mounted at startup without pulling the native voice module into the launch
// graph. Renders nothing until a call invite arrives.
//
// NOTE: incoming calls only ring once the Twilio Android **FCM push credential**
// is configured and a fresh build is installed (owner infra) — until then this
// modal simply never mounts. The UI + accept/reject wiring are ready.

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Brand, BrandGradient } from '@/constants/theme';
import { maybePromptIntakeFor } from '@/lib/intake-prompt';
import { getIncomingCall, getIncomingCallName, subscribeIncomingCall } from '@/lib/twilio-state';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function RoundButton({
  label, icon, onPress, bg, big, rotate,
}: {
  label: string; icon: IconName; onPress: () => void; bg: string; big?: boolean; rotate?: boolean;
}) {
  const size = big ? 70 : 60;
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ height: size, width: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={28} color="#fff" style={rotate ? { transform: [{ rotate: '135deg' }] } : undefined} />
      </View>
      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function IncomingCallModal() {
  const call = useSyncExternalStore(subscribeIncomingCall, getIncomingCall, getIncomingCall);
  // #10: resolved caller name (Opiflow customer or device contact). Separate store
  // so it can upgrade the label without changing the call session's identity.
  const callerName = useSyncExternalStore(subscribeIncomingCall, getIncomingCallName, getIncomingCallName);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);

  const connected = call?.phase === 'connected';

  useEffect(() => {
    if (!connected) {
      setSeconds(0);
      setMuted(false);
      return;
    }
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [connected]);

  // End-of-call intake popup for inbound: when an ANSWERED inbound call to a NEW
  // (unknown) number ends, auto-ask whether to send the details request — parity
  // with the outbound dialer. Tracked across the call's lifetime via a ref so we
  // fire once, right after the modal closes.
  const sessRef = useRef<{ from: string | null; connected: boolean }>({ from: null, connected: false });
  useEffect(() => {
    if (call) {
      if (call.from) sessRef.current.from = call.from;
      if (call.phase === 'connected') sessRef.current.connected = true;
    } else if (sessRef.current.connected && sessRef.current.from) {
      const from = sessRef.current.from;
      sessRef.current = { from: null, connected: false };
      void maybePromptIntakeFor(from);
    } else {
      sessRef.current = { from: null, connected: false };
    }
  }, [call]);

  if (!call) return null;

  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const toggleMute = () => {
    const next = !muted;
    call.mute(next);
    setMuted(next);
  };

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={() => call.reject()}>
      <LinearGradient colors={[...BrandGradient]} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: 72, paddingHorizontal: 32 }}>
          <View />

          {/* Caller */}
          <View style={{ alignItems: 'center' }}>
            <View style={{ height: 112, width: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}>
              <Ionicons name="call" size={48} color="#fff" />
            </View>
            <Text style={{ marginTop: 28, color: '#fff', fontSize: 24, fontWeight: '800' }} numberOfLines={1}>
              {callerName ?? call.from ?? 'Άγνωστος'}
            </Text>
            {callerName && call.from ? (
              <Text style={{ marginTop: 4, color: 'rgba(255,255,255,0.75)', fontSize: 15 }} numberOfLines={1}>
                {call.from}
              </Text>
            ) : null}
            <Text style={{ marginTop: 8, color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>
              {connected ? timer : 'Εισερχόμενη κλήση'}
            </Text>
          </View>

          {/* Controls */}
          <View>
            {connected ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 56 }}>
                <RoundButton label={muted ? 'Άρση σίγασης' : 'Σίγαση'} icon={muted ? 'mic-off' : 'mic'} onPress={toggleMute} bg="rgba(255,255,255,0.15)" />
                <RoundButton label="Τερματισμός" icon="call" rotate big onPress={() => call.disconnect()} bg={Brand.danger} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 72 }}>
                <RoundButton label="Απόρριψη" icon="call" rotate big onPress={() => call.reject()} bg={Brand.danger} />
                <RoundButton label="Απάντηση" icon="call" big onPress={() => call.accept()} bg={Brand.success} />
              </View>
            )}
          </View>
        </View>
      </LinearGradient>
    </Modal>
  );
}

export default IncomingCallModal;
