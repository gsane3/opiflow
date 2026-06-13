// Disable @react-native-firebase/app autolinking on iOS.
//
// We added @react-native-firebase/app ONLY to initialize FirebaseApp for the
// Twilio ANDROID Voice SDK (Android registration needs FCM). iOS uses
// PushKit/APNs and never touches Firebase — and the Firebase iOS CocoaPods fail
// to install in our Expo prebuild (they need a static-frameworks Podfile we
// don't use). Since the package is never imported in JS, excluding its iOS pod
// is safe and keeps the iOS build clean. Android autolinking is unchanged.
// Mirrors the Android-only config plugin in plugins/withFirebaseAndroidOnly.js.
module.exports = {
  dependencies: {
    '@react-native-firebase/app': {
      platforms: {
        ios: null,
      },
    },
  },
};
