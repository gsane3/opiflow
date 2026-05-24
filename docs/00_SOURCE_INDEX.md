# yorgos.ai Source Index

Last refreshed: 2026-05-24
Current product direction: backend-backed AI phone assistant and CRM automation platform.

## How every new chat should use Sources

1. Read this file first.
2. Then identify and read the newest available `Yorgosai_pN_handoff.md`.
3. Use the newest handoff as implementation state.
4. Use the product docs as product direction.
5. If a newer handoff conflicts with an older handoff, prefer the newer handoff for implementation state.
6. If a newer handoff conflicts with a product principle in these docs, mark it as `Conflict` and ask George before changing direction.
7. Do not rely on memory if the Sources say something different.

## Current implementation state to assume until a newer handoff exists

The latest confirmed handoff is `Yorgosai_p12_handoff.md`.

Confirmed p12 state:
- Repo path: `E:\yorgos`
- Branch: `master`
- Last confirmed HEAD: `763837a Remove visible demo call entry points`
- Last confirmed origin/master: `763837a Remove visible demo call entry points`
- Last confirmed repo status: clean
- Production alias: `https://yorgos-umber.vercel.app`
- Visible demo/local call entry points were removed from main production surfaces.
- `/settings` was cleaned for backend pilot.
- Main visible routes passed production smoke and marker audit.
- Hidden demo and legacy local/demo code may still exist, but product direction is to remove it fully.

## Source files

### `00_PROJECT_CONTEXT.md`
High-level product truth. Read this for:
- what yorgos.ai is
- target users
- core value proposition
- privacy and consent principles
- current strategic direction

### `01_PRODUCT_SPEC.md`
Product scope and roadmap. Read this for:
- product pillars
- live pilot scope
- v1, soon and later features
- sector strategy
- non-goals and safety rules

### `02_UI_GUIDE.md`
UI principles. Read this for:
- mobile-first layout rules
- assistant-first UX
- customer workspace requirements
- calls, AI Assistant, timeline, files and review-first screens

### `03_USER_FLOWS.md`
Expected user flows. Read this for:
- registration and sector setup
- managed phone number flow
- incoming call flows
- AI Assistant flows
- offer and appointment response links
- reject client and out-of-hours flows

### `04_DATA_MODEL.md`
Domain and backend entities. Read this for:
- Supabase/backend pilot data model
- customer, call, task, offer, appointment and token entities
- provider connection and automation entities
- privacy boundaries for raw audio and transcripts

### `05_MVP_BUILD_SPEC.md`
Backend pilot build plan. Read this for:
- next build sequence
- acceptance criteria
- what should be backend-backed
- what must not be faked

### `06_COPY_AND_LABELS.md`
Greek labels and copy. Read this for:
- navigation labels
- customer workspace labels
- reject client message copy
- out-of-hours copy
- review-first and provider fallback copy

### `07_BUILD_PROMPT.md`
Coding-agent protocol. Read this before giving Claude or a code agent a task.

## Working protocol

George runs all commands manually:
- PowerShell
- git
- npm
- lint
- build
- VPS commands
- provider commands

ChatGPT gives exact copy-paste PowerShell blocks. Every PowerShell block must start with:

```powershell
Clear-Host
Set-Location E:\yorgos
```

Claude/code agents must:
- not run commands
- edit only explicitly allowed files
- make targeted edits
- preserve Greek UTF-8
- If you see mojibake or corrupted Greek text, STOP and report the exact file and area.
- not create stray files
- not add packages unless explicitly approved
- not use scripts or encoding conversion to fix Greek text unless explicitly approved

Validation before commits:
- expected files only
- `git diff --check` clean
- targeted ESLint when code is patched
- full `npm run build` before important commits
- exact `git add` paths only, never broad `git add .`

## Security and privacy rules

Never ask George to paste:
- secrets
- tokens
- passwords
- private keys
- SIP credentials
- webhook secrets
- provider credentials
- raw env values
- full phone numbers
- full sensitive URLs

Use presence, length, redaction, masking or short fingerprints for diagnostics.

## Product rules that must be preserved

- Greek UI for the Greek market.
- Mobile-first.
- Assistant-first, not CRM-first.
- Calls are a core selling point.
- No hidden call recording.
- No fake provider claims.
- No automatic AI save without review.
- No automatic sending unless the provider flow is actually implemented, connected and explicitly approved.
- Review-first AI actions by default.
- Existing number forwarding is not guaranteed until provider testing confirms caller ID and legal/technical behavior.
