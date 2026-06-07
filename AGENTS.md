# Opiflow — agent brief

**Read `PROJECT_STATE.md` first** — it is the canonical, always-current state of this
project (infra IDs, changelog, current state, blockers, plan, loose ends). **Keep it
updated before every `/compact`** and after any significant change.

## Always-true essentials (full detail in PROJECT_STATE.md → section B)
- Product: **Opiflow** — Greek mobile-first business-phone + CRM for service technicians
  (was "yorgos"/"deskop"). Next.js 16 + React 19 + Tailwind v4 + Supabase + jsSIP.
- **Live app:** https://opiflow.vercel.app · **Vercel:** `sane127/opiflow`
- **Live Supabase project:** `oluhmztfimmgmbxoioea` (the deployed app uses this; `hgboywgjddphzeiwtezw` is the OLD/dead project to delete)
- **GitHub:** `gsane3/yorgos` (rename pending → opiflow) · **Local:** `E:\yorgos` (rename pending)
- **PBX:** `root@46.224.138.115` (Hetzner Ubuntu, Asterisk 20.6), key `~/.ssh/yorgos_pbx_vps_600`
- Migrations are applied **manually via the Supabase SQL editor** (don't `supabase db push`).

## Working rules
- Ship via PR → merge to `master` (direct push to master is blocked); `next build` must be green.
- The assistant **cannot read `.env.local` or handle raw secrets** — the user places them.
- Brand accent = emerald `#00C499` (mapped onto the `indigo-*` Tailwind scale in `globals.css`).
