# yorgos.ai Backend Pilot Build Spec

Last refreshed: 2026-05-24
This file replaces the old local MVP build direction with the current backend-backed pilot plan.

## Goal

Build a live-ready backend pilot of yorgos.ai as an AI phone assistant and CRM automation platform for Greek professionals who handle many calls.

The pilot should demonstrate:

Call or lead
→ AI brief or AI Assistant command
→ user review
→ customer workspace update
→ tasks, appointments, offers or messages
→ customer response link or provider action

## Current product truth

The project is no longer just a local/mock MVP.

Current direction:
- backend-backed CRM surfaces
- managed phone number flow
- call logging and AI brief
- customer workspace
- public token flows for offer and appointment responses
- AI Assistant as a core live feature
- provider-gated sends
- review-first actions
- demo/local visible surfaces should be removed

## Required stack direction

Current stack:
- Next.js
- TypeScript
- Tailwind CSS
- Supabase/backend APIs
- provider webhooks
- Vercel deployment
- PBX/SIP/provider work
- AI processing through backend routes
- future calendar and provider integrations

Do not build new live features on localStorage.

## Build priorities

### Phase 1. Documentation refresh

Update source docs to reflect:
- AI phone assistant direction
- backend pilot state
- sector strategy
- managed number strategy
- review-first AI actions
- provider-gated sends
- no hidden recording
- no fake provider claims

Acceptance:
- docs are consistent
- `00_SOURCE_INDEX.md` exists
- build prompt is updated
- no secrets included

### Phase 2. Backend-backed Customer Workspace

Build customer detail as the central work area.

Required sections:
- editable customer details
- calls
- AI call briefs
- timeline
- notes
- tasks
- appointments
- offers
- files
- messages
- next best action
- reject client action

Rules:
- backend-backed only
- no localStorage fallback for live route
- no demo copy
- all edits use authenticated APIs
- timeline records important actions

Acceptance:
- user can edit customer fields
- user can create/edit tasks inside customer
- user can create/edit appointments inside customer
- user can create offers inside customer
- user can view calls and briefs
- user can see timeline
- user can use reject client review flow
- targeted ESLint and full build pass

### Phase 3. Remove demo/local routes and fallbacks

Remove or archive:
- `/demo`
- `/call/mock`
- demo banners
- localStorage demo fallbacks
- visible MVP/local copy
- old local customer profile dependencies

Rules:
- do not break backend live routes
- hidden test utilities can remain only if clearly internal and not reachable from main shell

Acceptance:
- source scan has no visible demo/local references in live app routes
- production marker audit passes
- build passes

### Phase 4. Backend-backed AI Assistant

Make `/cmd` a live AI Assistant.

It should support:
- create task
- create appointment
- create offer
- draft/send message
- reject client
- search customer
- answer daily priority questions
- show pending offers
- show pending calls/leads

Rules:
- review-first by default
- backend-backed writes
- no localStorage live actions
- provider sends only when enabled and approved
- customer disambiguation required
- warnings when uncertain

Acceptance:
- command creates review object
- user approves before save/send
- backend records action
- timeline records action
- no automatic send without explicit confirmation

### Phase 5. Reject client action

Add `Reject client`.

Flow:
- user opens customer
- clicks reject client
- app generates polite message
- user reviews and edits
- if provider enabled, send after confirmation
- if provider unavailable, create copyable draft
- update customer status if approved
- write timeline event

Acceptance:
- no provider fake send
- draft fallback works
- message copy is professional
- timeline event is created
- status update is review-first

### Phase 6. Provider readiness

Harden and verify:
- PBX/SIP configuration
- call recording consent
- webhook security
- Apifon/Viber production setup
- email provider setup
- provider failures and retries
- delivery status tracking
- logs and monitoring
- retention policy

Acceptance:
- no raw secrets in logs
- no hidden recording
- provider sends are real or clearly unavailable
- failures are visible and recoverable

### Phase 7. Calendar integration

Support:
- Google Calendar
- Apple Calendar through the safest practical integration, for example ICS/calendar feed first if direct API is not ready
- internal appointment source of truth

Acceptance:
- accepted appointment can sync/export
- calendar errors are shown
- no false claim of sync when not implemented

### Phase 8. Lead automation

Start with:
- generic webhook
- WordPress forms

Later:
- Meta
- Google
- TikTok

Flow:
- lead arrives
- customer/lead created
- call requirement task created
- optional acknowledgement message draft/send
- timeline event created

Acceptance:
- lead source is tracked
- duplicate matching is safe
- user can see pending call tasks

### Phase 9. Sector profiles

Build sector-specific defaults.

First:
- technical services

Later:
- accounting
- real estate
- spare parts
- doctors
- takeaway
- construction

Acceptance:
- sector changes AI prompt context
- sector changes templates
- sector changes default fields and task types

## Live route expectations

Main live app should include:
- `/dashboard`
- `/calls`
- `/customers`
- `/customers/[id]`
- `/cmd` or `/ai-assistant`
- `/tasks`
- `/appointments`
- `/offers`
- `/offers/[id]`
- `/settings`

Public routes:
- `/intake/[token]`
- `/offer-response/[token]`
- `/appointment-response/[token]`

## What must not be faked

- provider sends
- call recording
- calendar sync
- legal compliance
- caller ID passthrough on forwarded numbers
- customer response recording
- offer acceptance
- appointment acceptance

## Review-first acceptance criteria

For any AI or message action:
- show proposed result
- allow edit
- show warnings
- require approval
- only then save/send
- log the action

## Privacy-safe acceptance criteria

- no hidden recording language
- consent/notice is clear where applicable
- raw audio is controlled
- transcript is not normal UI output by default
- call brief is short and useful
- public tokens are hashed
- secrets never leave backend
