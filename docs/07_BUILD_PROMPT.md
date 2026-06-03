# deskop.ai Build Prompt

Last refreshed: 2026-05-24
Use this prompt and protocol for future coding agents.

## Role

You are building deskop.ai, a backend-backed AI phone assistant and CRM automation platform for Greek professionals who handle many calls.

Build step by step. Do not overbuild.

## Current product direction

deskop.ai is not a traditional CRM.

It is:
- AI phone assistant
- managed business phone workflow
- call brief system
- customer workspace
- task and appointment assistant
- offer assistant
- response link system
- provider automation platform
- sector-aware business assistant

First sector:
- technical services and Greek call-heavy professionals

Later sectors:
- accountants
- real estate
- spare parts
- doctors
- takeaway
- construction
- other services

## Current implementation assumptions

Use the newest `Deskopai_pN_handoff.md` for implementation state.

As of p12:
- repo path is `E:\deskop`
- backend pilot surfaces exist
- visible demo/local call entry points were removed from main app surfaces
- hidden demo/local code may still exist
- product direction is to remove demo/local fully
- `/cmd` AI Assistant is core and should become backend-backed
- customer workspace is core and should become backend-backed and editable

## Critical product rules

- Greek-first UI.
- Mobile-first.
- Assistant-first, not CRM-first.
- Calls are core.
- No hidden call recording.
- No fake provider claims.
- No automatic AI save without review by default.
- No automatic message sending unless provider flow is implemented, connected and explicitly approved.
- Review-first AI actions.
- Auto-send only with explicit automation rule.
- Do not build new live features on localStorage.
- Do not show visible demo/local MVP copy in live product surfaces.
- Do not assume forwarded calls preserve original caller ID until provider testing proves it.
- Do not claim legal compliance without legal review.
- Preserve Greek UTF-8.

## Development protocol for Claude/code agents

CRITICAL RULES:
1. DO NOT run commands.
2. No git status.
3. No git diff.
4. No npm run lint.
5. No npm run build.
6. No PowerShell.
7. No shell.
8. No terminal commands.
9. The user runs all commands manually.
10. Read files only when needed.
11. Edit only files explicitly listed in the prompt.
12. Make targeted edits only.
13. Do not refactor unrelated code.
14. Do not rewrite whole files unless explicitly requested.
15. Preserve Greek UTF-8.
16. If you see mojibake or corrupted Greek text, STOP and report the exact file and area.
17. Do not use scripts or encoding conversion to fix Greek text unless explicitly approved.
18. Do not create stray files.
19. Do not add packages unless explicitly approved.
20. Do not touch secrets or env values.
21. Do not include raw tokens, passwords, SIP credentials, provider credentials, private URLs or full phone numbers.
22. Do not use em dash characters. Use a comma or a period instead.

At the end of every code-agent task, report:
- files changed
- summary by file
- what was intentionally not changed
- assumptions
- questions
- manual validation commands for George

## ChatGPT PowerShell protocol

Every PowerShell block given to George must start with:

```powershell
Clear-Host
Set-Location E:\deskop
```

George runs:
- PowerShell
- git
- npm
- lint
- build
- VPS commands
- provider commands

ChatGPT reviews output and responds with:
- PASS or STOP
- short diagnosis
- next safest step

## Git protocol

- Commit only after validation passes.
- Use exact file paths in `git add`.
- Never use broad `git add .`.
- For paths with brackets such as `[id]` or `[token]`, use literal path handling.
- CRLF warnings are usually OK unless lint, build or `git diff --check` fails.
- Remove stray files before commit.

## Validation protocol

For docs-only changes:
- `git status --short --untracked-files=all`
- `git diff --stat`
- `git diff --check`
- UTF-8/mojibake scan
- em dash scan
- final `git status`

For code changes:
- `git status --short --untracked-files=all`
- `git diff --stat`
- `git diff --check`
- targeted ESLint for changed code files
- full `npm run lint` when appropriate
- full `npm run build` before important commits
- browser or production smoke when route behavior changes

## Build sequence from current state

### Step 1. Documentation refresh

Update source docs to backend pilot truth.

### Step 2. Backend-backed Customer Workspace

Build customer detail as central workspace.

Allowed features:
- edit customer details
- calls and call briefs
- timeline
- notes
- files metadata
- tasks
- appointments
- offers
- messages
- reject client
- next best action

Rules:
- backend-backed only
- no localStorage live path
- no demo copy
- review-first for AI actions
- timeline/audit record for important changes

### Step 3. Remove demo/local code

Remove or archive:
- `/demo`
- `/call/mock`
- demo banners
- local demo fallbacks
- unused legacy CustomerProfile code if replaced
- localStorage live dependencies

Rules:
- do not break live routes
- do not remove test utilities without confirming they are unused
- validate routes after deletion

### Step 4. Backend-backed AI Assistant

Make `/cmd` live.

Supported intents:
- query customers
- query calls
- create task
- create appointment
- create offer
- draft/send message
- reject client
- summarize day
- find pending actions

Rules:
- review-first
- customer disambiguation
- backend writes only after approval
- provider sends only after confirmation and only if implemented
- timeline records output

### Step 5. Reject client action

Implement:
- customer action button
- AI/professional message draft
- review modal
- provider send if enabled
- copyable draft fallback
- status update
- timeline event

### Step 6. Provider readiness

Work on:
- PBX hardening
- SIP firewall
- recording notice/consent
- Viber provider hardening
- email provider
- delivery status
- retries
- monitoring
- retention policy

### Step 7. Calendar integration

Support:
- Google Calendar
- Apple Calendar or practical ICS/calendar feed path
- internal appointment source of truth

### Step 8. Lead automations

Start with:
- generic webhook
- WordPress forms

Later:
- Meta
- Google
- TikTok

### Step 9. Sector profiles

Start with:
- technical services

Later:
- accounting
- real estate
- spare parts
- doctors
- takeaway
- construction

## Example Claude prompt header

```text
You are editing the deskop.ai Next.js project.

CRITICAL RULES:
1. DO NOT run commands. No git, npm, PowerShell, shell or terminal commands.
2. The user runs all commands manually.
3. Edit only the files explicitly listed in this prompt.
4. Make targeted edits only.
5. Preserve Greek UTF-8.
6. Stop on mojibake or corrupted Greek text.
7. Do not create stray files.
8. Do not add packages unless explicitly approved.
9. Do not include secrets.
10. Do not make fake provider claims.
11. AI actions are review-first by default.
12. Do not build new live features on localStorage.
```

## Safety reminders

- Warn before actions that send real Viber/email/SMS messages.
- Warn before actions that place or receive real calls.
- Warn before actions that touch VPS/PBX configuration.
- Warn before actions that modify production-like data.
- Never ask George to paste secrets.
