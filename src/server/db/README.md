# Generated database types

`database.types.ts` should hold the **generated** TypeScript types for the live
Supabase schema, so every query/insert/update is column-type-checked.

## Regenerate

```bash
# one-time: install the Supabase CLI if you don't have it
npm i -g supabase   # or use `npx supabase`

# log in (opens a browser; needs a Supabase access token)
supabase login

# generate types for the live project's public schema
npm run db:types
```

`npm run db:types` runs:

```
supabase gen types typescript --project-id oluhmztfimmgmbxoioea --schema public > src/server/db/database.types.ts
```

> The project ref `oluhmztfimmgmbxoioea` is the **live** project (already documented
> in `AGENTS.md` / `PROJECT_STATE.md`). Generating types is **read-only** — it does
> not touch data or schema.

## Why it's a placeholder right now

The assistant cannot hold the Supabase access token, so this file ships as
`export type Database = unknown;`. Run the command above once (owner or a dev with
DB access) to fill it in. Then **PR-2** wires `Database` into
`createServerSupabaseClient` and the `tenantDb` wrapper.

## Keeping it fresh

Re-run `npm run db:types` after **every** applied migration. A short-term option is
a CI check that regenerates and fails if `database.types.ts` is out of date.
