// Tasteful haptic feedback — the "premium" tap on key actions (send, complete,
// chip). expo-haptics wraps the iOS Taptic engine / Android vibrator and, unlike
// expo-audio, touches NO audio session — so it can't conflict with Twilio Voice.
//
// Belt-and-suspenders after the expo-audio launch crash: the module is imported
// LAZILY inside each call (never at app launch / module eval), and every call is
// best-effort — any failure is swallowed, so haptics can never crash the app.

export async function hapticTap(): Promise<void> {
  try {
    const H = await import('expo-haptics');
    await H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch {
    /* haptics unavailable — silent no-op */
  }
}

export async function hapticSelect(): Promise<void> {
  try {
    const H = await import('expo-haptics');
    await H.selectionAsync();
  } catch {
    /* no-op */
  }
}

export async function hapticSuccess(): Promise<void> {
  try {
    const H = await import('expo-haptics');
    await H.notificationAsync(H.NotificationFeedbackType.Success);
  } catch {
    /* no-op */
  }
}

export async function hapticWarning(): Promise<void> {
  try {
    const H = await import('expo-haptics');
    await H.notificationAsync(H.NotificationFeedbackType.Warning);
  } catch {
    /* no-op */
  }
}
