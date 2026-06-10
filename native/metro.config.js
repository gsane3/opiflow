const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// @supabase/supabase-js (realtime-js / ws) — and some other packages — don't
// resolve cleanly under Metro's ES-module package "exports" resolution that Expo
// SDK 53+ enables by default (e.g. "Unable to resolve ./lib/normalizeChannelError").
// Fall back to the classic main-field resolver, which resolves them correctly.
// Ref: supabase/supabase-js#1258 · expo/expo#36551.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
