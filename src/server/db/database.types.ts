// Generated Supabase types — PLACEHOLDER (PR-1).
//
// Regenerate the real, column-accurate types with:
//
//   npm run db:types
//
// (requires the Supabase CLI logged in / a SUPABASE access token — see README.md
// in this folder.) Until then this is intentionally `unknown`, so nothing depends
// on a half-correct hand-written shape.
//
// PR-2 replaces this and wires `Database` into createServerSupabaseClient and the
// tenant wrapper, giving end-to-end column/Insert/Update type-safety and removing a
// whole class of "wrong column name / nullable-vs-required / stale after migration"
// bugs (overview §10, risk #4).

export type Database = unknown;
