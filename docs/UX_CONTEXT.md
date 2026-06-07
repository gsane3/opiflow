# Opiflow — UX/UI context (hand this to a design AI)

Give this file + the files listed at the bottom (and a few screenshots from
https://opiflow.vercel.app) to a UX/UI AI. Its output should be a concrete
**prompt/spec** that the engineering AI (Claude Code) then implements.

## What Opiflow is
A **Greek, mobile-first business-phone + CRM** for **service technicians** (HVAC
first) — "Customer Action Management". A technician, often **one-handed, in the
field, on a phone**, manages customers, sends offers/appointment/intake links,
and gets AI call briefs. Native app via Capacitor (loads the live web app).
**Design for: thumb reach, speed, glanceability, Greek copy, outdoor legibility.**

## Brand palette (IMPORTANT — read before restyling)
- **Primary accent = emerald `#00C499`.** BUT the codebase uses Tailwind's
  **`indigo-*`** classes everywhere, and `globals.css` REMAPS the whole `indigo`
  ramp to emerald (`indigo-500 = #00C499`, `indigo-600 = #00a07c`, `indigo-700 = #00805f`).
  → **Keep using `indigo-*` utility classes** for the brand accent. Do NOT switch
  to `emerald-*` (that's a different, un-remapped scale). Changing the palette =
  edit the `@theme` block in `src/app/globals.css` only.
- Secondary blue `#3361FF` (use `blue-*`). Dark navy `#0A1120`. Neutrals = `zinc-*`.
- Status colors: green=won/accepted, red=lost/rejected, amber=pending/warning, blue=sent.

## Design language (current conventions — match these)
- Font: Geist (Latin) + system fallback for Greek (`--font-sans`).
- **Cards:** white, `rounded-[28px]`, `shadow-sm`, `ring-1 ring-zinc-200/60`, `px-5 py-4`.
- Buttons: filled `rounded-xl bg-indigo-600 text-white`; secondary `border border-zinc-200 bg-white`.
- Pills/badges: `rounded-full px-2 py-0.5 text-xs font-medium ring-1`.
- Mobile-first: `max-w-md` content column, `md:` widens to `max-w-2xl/4xl`.
- Safe-area insets (notch/home-indicator): `env(safe-area-inset-*)`, `.pb-safe`.
- Inputs ≥16px font (prevents iOS zoom). Tap highlight removed (feels native).
- Greek UI throughout. Emojis used sparingly as glyphs (✨🔔👋).

## Reusable UI primitives — `src/components/ui/`
`Button`, `Card`, `Badge`, `Input`, `Textarea`, `Spinner`, `EmptyState`, `cn()` (class merge).
**Prefer reusing/extending these** over new one-off styles.

## App frame (navigation)
- `layout/AppShell.tsx` — auth gate + branded splash + global AI-assistant FAB (→ `/cmd`).
- `layout/BottomNav.tsx` — primary mobile nav (Αρχική / Κλήσεις / Πελάτες / AI / Περισσότερα).
- `layout/DesktopSidebar.tsx` — desktop nav. `layout/PushToast.tsx` — in-app push banner.

## Screen map (`src/app/(app)/*/page.tsx`)
- `dashboard` — home / today's overview.
- `customers` — list (search, status filter chips, stat tiles). `customers/[id]` — **the main workspace** (hero + status pipeline + timeline of calls/tasks/offers + AI «Σύνοψη από κλήσεις» + quick actions). NOTE: huge file (~3400 lines) — best understood via screenshots.
- `offers` + `offers/[id]` — quote builder + preview. `tasks` — agenda (today/overdue/done). `appointments` — scheduling + time-change negotiation.
- `stats` — sales metrics (pipeline value, won/month, win-rate, open tasks). `search` — global. `cmd` — AI command assistant. `settings` — business profile, providers, team, notifications, service status, account. `calls` — call log. `ai-review` — AI suggestion scratchpad.
- **Public customer-facing** (no nav, branded): `intake/[token]`, `offer-response/[id]`, `appointment-response/[id]`, `upload/[token]` — what the customer sees when they tap the link.

## Good UX targets (where help is most valuable)
- The **customer detail workspace** density vs. clarity (it does a lot).
- **Bottom-nav + FAB** ergonomics (one-handed).
- **Empty states / first-run** guidance for a non-technical technician.
- **Public token pages** — trust + conversion (a customer's first impression of the business).
- Consistent **card/spacing rhythm** and a tighter type scale.

## How to feed the result back to Claude Code
The design AI's output should be a **prompt** like: "On `customers/[id]`, restructure
the hero into X; move quick-actions to a sticky bottom bar; use `ui/Card` with …".
Reference screens by their route, reuse the palette/conventions above, and Claude
will implement + keep `next build` green.
