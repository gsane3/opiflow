// Global AI-command bottom sheet. The raised AI FAB in the glass tab bar opens
// this instead of pushing the full-screen /cmd route, so the assistant slides up
// as a sheet with the current screen peeking behind (matches the design AISheet).

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AiCommand } from '@/app/cmd';
import { useTheme } from '@/hooks/use-theme';

type AiSheetValue = { show: () => void; hide: () => void };

const AiSheetContext = createContext<AiSheetValue>({ show: () => {}, hide: () => {} });

export function AiSheetProvider({ children }: { children: ReactNode }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <AiSheetContext.Provider value={value}>
      {children}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={hide}>
        <View style={styles.root}>
          {/* tap the dimmed area above the sheet to dismiss */}
          <Pressable style={StyleSheet.absoluteFill} onPress={hide} />
          <View style={[styles.sheet, { backgroundColor: c.card }]}>
            <View style={styles.grabberWrap}>
              <View style={[styles.grabber, { backgroundColor: c.border }]} />
            </View>
            {open ? <AiCommand onClose={hide} /> : null}
          </View>
        </View>
      </Modal>
    </AiSheetContext.Provider>
  );
}

export function useAiSheet() {
  return useContext(AiSheetContext);
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,17,32,0.45)' },
  sheet: {
    height: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: -6 } },
      android: { elevation: 24 },
    }),
  },
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 2 },
  grabber: { width: 40, height: 5, borderRadius: 3 },
});
