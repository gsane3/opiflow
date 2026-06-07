#!/usr/bin/env python3
"""Inject the APNs-forwarding methods that @capacitor-firebase/messaging requires
into the Capacitor-generated AppDelegate.swift.

Capacitor's `cap add ios` regenerates a default AppDelegate on every clean CI
build, so this patch is applied in CI (see codemagic.yaml ios-release) rather
than committed. It is idempotent — running it twice is a no-op.

Reference: node_modules/@capacitor-firebase/messaging/README.md → iOS section.
NOTE: we do NOT call FirebaseApp.configure() here — @capacitor-firebase/app
auto-initializes Firebase from GoogleService-Info.plist.
"""
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "ios/App/App/AppDelegate.swift"

with open(path, "r", encoding="utf-8") as f:
    src = f.read()

if "capacitorDidRegisterForRemoteNotifications" in src:
    print("AppDelegate already patched — skipping")
    sys.exit(0)

methods = """
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }
"""

anchor = "var window: UIWindow?"
idx = src.find(anchor)
if idx == -1:
    sys.stderr.write("ERROR: could not find 'var window: UIWindow?' in AppDelegate.swift\n")
    sys.exit(1)

idx += len(anchor)
patched = src[:idx] + "\n" + methods + src[idx:]

with open(path, "w", encoding="utf-8") as f:
    f.write(patched)

print("AppDelegate patched with APNs-forwarding methods")
