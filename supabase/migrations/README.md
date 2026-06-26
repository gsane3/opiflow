# Database migrations

Migrations are applied **by hand** in the Supabase SQL editor (we do **not** run
`supabase db push`). Files are numbered `NNN_name.sql` and applied in order.

## Tracking (migration 065+)

`public.schema_migrations` records which migrations are applied, so repo↔DB drift is
visible instead of surfacing as a runtime failure.

**Convention — every NEW migration ends with a self-record line** so pasting it into
the SQL editor also records it:

```sql
INSERT INTO public.schema_migrations (version, filename)
VALUES ('066', '066_my_change.sql')
ON CONFLICT (version) DO NOTHING;
```

## Workflow

1. **First time only** (after applying `065_schema_migrations.sql`): backfill the
   historical migrations (001..064 are already live) —
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-migrations.mjs --backfill
   ```
2. **Apply a new migration**: paste its SQL into the Supabase SQL editor (the trailing
   `INSERT` self-records it).
3. **Check for drift** anytime (also a good CI step once secrets are wired):
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-migrations.mjs
   ```
   Exit code `1` + a list when a migration on disk isn't recorded as applied.

## Tolerance

App code stays **tolerant** of a not-yet-applied migration (degrades instead of
crashing — see e.g. the pre-044/053/060/064 fallbacks), so a brief repo-ahead-of-DB
window during a deploy is safe. Tracking just makes that window *visible*.
