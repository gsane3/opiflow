# yorgos.ai Voice/SMS Architecture

## Status

- Not implemented yet.
- Required for working private beta v1.
- Backend foundation exists, but voice/SMS capture, recording, transcription, AI brief pipeline, CRM timeline, and provider integration are not implemented yet.
- Provider availability, Greek numbers, SMS rules, pricing, DPA, and legal consent must be verified before production.

---

## v1 Product Requirement

Business phone and SMS must feed the CRM automatically. Manual call logging is not required for the core flow.

Requirements:
- Every business managed by yorgos.ai must be able to receive calls and SMS through a provider-managed number that routes to the CRM.
- When a call ends, the system must retrieve the recording and transcribe it without manual action by the user.
- The backend generates an AI brief from the transcript and saves it automatically as pending review.
- No manual call summary is required for the core flow. The brief is ready for the user to review, edit, confirm, or dismiss.
- Task creation from a call is allowed only as ai_draft status and only when confidence and next action are clear.
- Offers must not be auto-created from a brief. The user must initiate offer creation.
- Outbound SMS sends must not be auto-sent. The user must approve all outbound messages.
- Customer status changes proposed by AI must be confirmed by the user before taking effect.

---

## End-to-End Call-to-CRM Flow

1. Business owner provisions or registers a provider-managed phone number for their account.
2. An incoming call arrives on that number.
3. A consent announcement plays before recording begins (required by applicable law).
4. Call is connected to the business owner's device and recorded if consent rules allow it.
5. Call ends.
6. Provider sends a call status webhook and a recording-ready webhook when the recording is available.
7. Backend receives the webhook and stores the raw provider event idempotently using the provider event ID.
8. Backend matches the caller phone number (normalized to E.164) against existing customers, or creates a new customer record with status pending.
9. Backend creates a call record and a communication record linked to that customer.
10. Backend stores recording metadata (duration, provider recording ID, consent status, not raw audio yet).
11. Backend downloads or references the recording file for the transcription job.
12. Transcription job runs asynchronously: audio is submitted to the transcription provider, result is stored in call_transcripts.
13. AI brief job runs after transcript is ready: transcript is submitted to the AI model, structured brief is generated.
14. Brief is saved to the CRM as ai_brief with status pending_review.
15. ai_draft tasks are created automatically only when confidence score meets threshold and next action is unambiguous.
16. User opens the customer timeline and sees the call, transcript, AI brief, and any draft tasks ready for review.

---

## Recording and Transcription Options

### Option 1: Recording after call, then transcription (recommended for v1)

- Value: Simple, provider-agnostic, well-supported by all major providers. Recording file is available after call ends.
- Risk: Adds latency between call end and brief appearing in CRM (typically 1 to 5 minutes depending on call length and transcription queue).
- Complexity: Low. Standard webhook flow. No streaming required.
- Reliability: High. Provider stores recording before webhook fires. No data loss risk.
- v1 fit: Recommended. Meets the core requirement without streaming infrastructure.
- Privacy/legal: Recording is stored by provider. DPA with provider required. Recording must be accessed via signed URLs. Consent announcement required before recording begins.

### Option 2: Live transcription during call

- Value: Transcript available immediately when call ends. Lower latency brief.
- Risk: Requires real-time streaming infrastructure (WebSocket or SIP integration). Significantly more complex.
- Complexity: High. Streaming audio pipeline, real-time error handling, mid-call recovery.
- Reliability: Lower than post-call. Network issues during call can cause partial transcript.
- v1 fit: Not recommended for v1. Plan for v1.1 or later.
- Privacy/legal: Same consent requirements. Audio stream is processed live, increasing privacy surface area.

### Option 3: Provider-native transcription

- Value: Some providers offer built-in transcription. Avoids an extra transcription API call.
- Risk: Quality may be lower than dedicated transcription models. Greek language quality is unverified.
- Complexity: Low if the provider is already selected. No extra API integration.
- Reliability: Depends on provider. May not be available in all regions or for all languages.
- v1 fit: Evaluate once provider is selected. Do not assume availability.
- Privacy/legal: Data is processed within the same provider ecosystem. Verify DPA scope covers transcription data.

### Option 4: Dedicated transcription API (OpenAI Whisper or equivalent)

- Value: High transcription quality, strong multilingual support including Greek. Independent of provider.
- Risk: Additional API cost per call. Requires audio transfer to a third-party subprocessor.
- Complexity: Medium. Audio file must be downloaded and submitted. Polling or webhook for result.
- Reliability: High for well-tested APIs. Requires retry handling.
- v1 fit: Recommended alongside Option 1. Use after-call recording as input.
- Privacy/legal: Audio is shared with a third-party subprocessor. A DPA is required. Audio must not be retained by the subprocessor beyond the transcription request unless explicitly allowed.

### Recommendation

v1 should use Option 1 (recording after call) combined with Option 4 (dedicated transcription API). This combination is the most reliable, best-supported, and easiest to reason about for legal compliance.

Live transcription (Option 2) is v1.1 or later.

---

## Provider Abstraction

Provider-specific code must not be scattered across the codebase. All provider interaction must go through a normalized abstraction layer.

Requirements:
- Normalize provider events to a shared internal event format before any business logic runs.
- Verify webhook signatures before processing any event. Reject unsigned or invalid webhooks with 401.
- Store every raw provider event in provider_webhook_events before processing. This allows replay and audit.
- Use idempotency keyed on provider event ID. If the same event arrives twice, do not process it twice.
- Implement retry handling for downstream jobs. Provider will retry webhooks on 5xx. Handle gracefully.

Proposed module structure (these files are proposed, not implemented):

- `src/lib/phone/types.ts`: shared types: NormalizedCallEvent, NormalizedSmsEvent, CallStatus, ProviderEvent
- `src/lib/phone/provider.ts`: PhoneProvider interface definition
- `src/lib/phone/twilio.ts`: Twilio implementation, signature verification, event normalization
- `src/lib/phone/vonage.ts`: Vonage implementation, signature verification, event normalization
- `src/lib/phone/telnyx.ts`: Telnyx implementation, signature verification, event normalization
- `src/lib/phone/normalize.ts`: maps provider-specific fields to NormalizedCallEvent and NormalizedSmsEvent
- `src/lib/phone/signatures.ts`: signature verification utilities, provider-specific HMAC/header logic

These files are proposed, not implemented.

---

## Database Model Proposal

All tables follow the existing RLS pattern: business_id on every row, policy enforces access via business_users. Do not write full SQL yet.

### customers (Phase 3, extended for voice)

- Purpose: CRM contacts. Must include phone and mobile_phone for call/SMS matching.
- Essential additions for voice: phone (E.164 normalized), mobile_phone (E.164), intake_status.
- Relationships: linked to calls, communications, sms_messages, tasks, ai_briefs.
- RLS: business_members_only.
- Indexes: (business_id, phone), (business_id, mobile_phone), (business_id, email).
- v1 required.

### communications (Phase 3, extended for voice)

- Purpose: Outbound/inbound communication log. Entries for calls, SMS, email.
- Essential columns: id, business_id, customer_id, channel (call/sms/email), direction (inbound/outbound), status, phone, summary, created_at.
- Relationships: linked to customers, calls, sms_messages.
- RLS: business_members_only.
- Indexes: (business_id, customer_id, channel).
- v1 required.

### calls (Phase 6)

- Purpose: One record per call, inbound or outbound.
- Essential columns: id, business_id, customer_id, communication_id, provider, provider_call_sid, direction, status, from_number, to_number, started_at, ended_at, duration_seconds, consent_announced, recording_enabled, recording_status.
- Relationships: business, customer, communication, call_recordings, call_transcripts, ai_briefs.
- RLS: business_members_only.
- Indexes: (business_id, customer_id), (business_id, provider_call_sid), (business_id, started_at).
- v1 required.

### call_recordings (Phase 6)

- Purpose: Metadata about each recording. Does not store the audio blob directly.
- Essential columns: id, call_id, business_id, provider, provider_recording_sid, recording_url, storage_path, duration_seconds, consent_status, retained_until, deleted_at, created_at.
- Relationships: calls.
- RLS: business_members_only. Access to recording_url requires signed URL, not raw URL.
- Indexes: (business_id, call_id).
- v1 required.

### call_transcripts (Phase 6)

- Purpose: Transcript text linked to a call recording.
- Essential columns: id, call_id, recording_id, business_id, transcript_text, language, provider, status (pending/complete/failed), confidence_score, word_timestamps (jsonb, optional), created_at.
- Relationships: calls, call_recordings.
- RLS: business_members_only.
- Indexes: (business_id, call_id), (status).
- v1 required.

### ai_briefs (Phase 6)

- Purpose: AI-generated structured brief from transcript.
- Essential columns: id, call_id, transcript_id, business_id, customer_id, status (pending_review/confirmed/dismissed), brief_json (jsonb), confidence_score, model_used, created_at, confirmed_at, dismissed_at.
- Relationships: calls, call_transcripts, customers.
- RLS: business_members_only.
- Indexes: (business_id, customer_id, status), (business_id, call_id).
- v1 required.

### tasks (Phase 3, extended for voice)

- Purpose: Follow-up tasks. ai_draft status is added for AI-proposed tasks from call briefs.
- Essential addition: status must include ai_draft value. created_from_ai boolean. source_brief_id references ai_briefs.
- RLS: business_members_only.
- v1 required (ai_draft status).

### business_phone_numbers (Phase 6)

- Purpose: Tracks provisioned phone numbers assigned to a business.
- Essential columns: id, business_id, number (E.164), provider, provider_sid, status (active/suspended/released), forward_to, working_hours (jsonb), recording_enabled, recording_announcement_verified, created_at.
- Relationships: businesses.
- RLS: business_members_only.
- Indexes: (business_id), (number).
- v1 required.

### sms_messages (Phase 6)

- Purpose: Inbound and outbound SMS log.
- Essential columns: id, business_id, customer_id, communication_id, provider, provider_message_sid, direction, from_number, to_number, body, status, sent_at, delivered_at, created_at.
- Relationships: customers, communications.
- RLS: business_members_only.
- Indexes: (business_id, customer_id), (business_id, from_number).
- v1 required (inbound). Outbound: v1.1.

### provider_webhook_events (Phase 6)

- Purpose: Immutable log of all raw provider webhook events. Enables idempotency, replay, and audit.
- Essential columns: id, provider, event_id (provider-assigned), event_type, payload (jsonb), processed, processed_at, error_message, created_at.
- Relationships: none (raw log).
- RLS: service-role write, no user-facing read.
- Indexes: (provider, event_id) unique, (processed), (created_at).
- v1 required.

### consent_events (Phase 6)

- Purpose: Immutable record that a consent announcement was played before a call was recorded.
- Essential columns: id, call_id, business_id, customer_phone, event_type (announcement_played/recording_started/recording_skipped), timestamp, provider_call_sid.
- Relationships: calls.
- RLS: business_members_only for read. Service role for write.
- Note: consent_events must never be deleted for as long as the associated recording exists.
- v1 required. This is a legal gate, not optional.

### ai_jobs (Phase 6)

- Purpose: Job queue for async transcription and AI brief jobs. Tracks status, retries, errors.
- Essential columns: id, job_type (transcribe/ai_brief), entity_id, entity_type, status (queued/running/complete/failed), attempts, max_attempts, error_message, started_at, completed_at, created_at.
- Relationships: call_recordings (for transcribe), call_transcripts (for ai_brief).
- RLS: service-role only.
- Indexes: (status, job_type), (entity_id, entity_type).
- v1 required.

---

## API and Webhook Proposal

### Provider Webhooks

| Method + Path | Purpose | Auth/Security | Idempotency | v1 Required |
|---|---|---|---|---|
| POST /api/webhooks/voice/inbound | Provider notifies of incoming call | Provider signature header verified | Store raw event, check provider event ID | Yes |
| POST /api/webhooks/voice/status | Call status updates (ringing, answered, ended) | Provider signature verified | Idempotent on provider event ID | Yes |
| POST /api/webhooks/voice/recording | Recording ready notification | Provider signature verified | Idempotent on recording SID | Yes |
| POST /api/webhooks/voice/transcription | Provider-native transcription ready (if used) | Provider signature verified | Idempotent on transcription ID | Optional |
| POST /api/webhooks/sms/inbound | Inbound SMS received | Provider signature verified | Idempotent on message SID | Yes |
| POST /api/webhooks/sms/status | Outbound SMS delivery status | Provider signature verified | Idempotent on message SID | v1.1 |

### Internal Job Endpoints

| Method + Path | Purpose | Auth/Security | Idempotency | v1 Required |
|---|---|---|---|---|
| POST /api/jobs/transcribe | Trigger or resume transcription job for a recording | Internal only, service role | Check ai_jobs status before running | Yes |
| POST /api/jobs/ai-brief | Trigger or resume AI brief job for a transcript | Internal only, service role | Check ai_jobs status before running | Yes |

### App API Endpoints

| Method + Path | Purpose | Auth/Security | Idempotency | v1 Required |
|---|---|---|---|---|
| GET /api/calls | List calls for business | Bearer token, business scope | N/A | Yes |
| GET /api/calls/[id] | Get single call detail | Bearer token, business scope | N/A | Yes |
| GET /api/calls/[id]/transcript | Get transcript for call | Bearer token, business scope | N/A | Yes |
| GET /api/calls/[id]/brief | Get AI brief for call | Bearer token, business scope | N/A | Yes |
| PATCH /api/calls/[id]/brief | Confirm, edit, or dismiss brief | Bearer token, business scope | N/A | Yes |
| GET /api/customers | List customers | Bearer token, business scope | N/A | Yes (Phase 3) |
| POST /api/customers | Create customer | Bearer token, business scope | Normalize phone before insert | Yes (Phase 3) |
| GET /api/customers/[id] | Get customer detail | Bearer token, business scope | N/A | Yes (Phase 3) |
| PATCH /api/customers/[id] | Update customer | Bearer token, business scope | N/A | Yes (Phase 3) |
| GET /api/tasks | List tasks | Bearer token, business scope | N/A | Yes (Phase 3) |
| POST /api/tasks | Create task | Bearer token, business scope | N/A | Yes (Phase 3) |
| PATCH /api/tasks/[id] | Update task status or fields | Bearer token, business scope | N/A | Yes (Phase 3) |
| GET /api/sms | List SMS messages | Bearer token, business scope | N/A | Yes |
| POST /api/sms/send | Send outbound SMS | Bearer token, user-approved only | Idempotent on message ID | v1.1 |
| PATCH /api/businesses | Update business settings | Bearer token, owner only | N/A | Yes |
| POST /api/businesses/phone-numbers | Provision or register a number | Bearer token, owner only | Idempotent on number/provider SID | Yes |
| GET /api/businesses/phone-numbers | List provisioned numbers | Bearer token, owner only | N/A | Yes |

---

## AI Brief Pipeline

### Input

The AI brief job receives the full transcript text from call_transcripts along with:
- call metadata: direction, duration, started_at
- customer context: name, company, existing status, existing needs_summary, existing notes (if available)
- business context: business type (for example construction, retail)

### Output JSON Schema

```json
{
  "summary": "string",
  "customer_needs": "string",
  "sentiment": "positive | neutral | negative | unclear",
  "next_action": "string | null",
  "next_action_type": "call_back | send_offer | follow_up | book_appointment | none | unclear",
  "confidence": 0.0,
  "proposed_status_change": "string | null",
  "proposed_tasks": [
    {
      "title": "string",
      "type": "string",
      "due_date": "string | null",
      "note": "string | null",
      "confidence": 0.0
    }
  ],
  "flags": ["string"]
}
```

### Confidence Scoring

- Confidence is a float from 0.0 to 1.0, set per brief and per proposed task.
- Brief confidence represents how clearly the transcript supports the generated summary and next action.
- Task confidence represents how clearly the transcript supports the specific proposed task.
- Threshold for auto-creating an ai_draft task: confidence >= 0.85 and next_action_type is not none or unclear.
- Below threshold: task is included in brief JSON for user review but not auto-created.

### Automatic Save Behavior

- Brief is always auto-saved as ai_brief with status pending_review.
- User is notified in-app that a new brief is waiting for review.
- Brief is visible in the customer timeline immediately after saving.

### Task Creation Rules

- Tasks may be auto-created only as ai_draft.
- Only create ai_draft task if confidence >= 0.85 and next_action_type is specific (not none or unclear).
- At most one ai_draft task per call. Do not flood the task list.
- User must explicitly confirm, edit, or dismiss each ai_draft task before it becomes a real task.

### What Not to Auto-Create

- Offers: never auto-created from a brief. User must initiate offer creation manually.
- Outbound SMS: never auto-sent. User must compose and approve.
- Customer status changes: proposed in brief JSON only, never applied automatically.

### Error States

- Transcription fails: ai_brief job is not started. Call record shows transcript_status: failed. User is notified.
- AI model returns malformed JSON: brief is saved with status error. Raw model output is stored for debugging.
- AI model call fails: job retries up to max_attempts. After max_attempts, brief status is error.
- Confidence too low for all fields: brief is saved with status pending_review. No tasks auto-created.

### Edit/Confirm/Dismiss UX

- User opens customer timeline and sees the call with a brief badge.
- User can read the brief, edit any field, confirm (saves as confirmed), or dismiss (saves as dismissed).
- Confirmed brief fields can be applied to the customer record (needs_summary, status) by explicit user action, not automatically.
- Dismissed briefs are hidden from the timeline but retained in the database for audit.

### Audit Trail

- Every brief action (created, confirmed, dismissed, edited) is logged with timestamp and user ID.
- Brief JSON before and after edit is stored in a changes log or versioned column.
- Audit trail is required before production, not optional.

---

## SMS Capture Plan

### Inbound SMS Flow

1. Customer sends SMS to the business provider number.
2. Provider fires inbound SMS webhook to POST /api/webhooks/sms/inbound.
3. Backend verifies webhook signature.
4. Backend stores raw event in provider_webhook_events.
5. Backend normalizes sender phone to E.164.
6. Backend matches sender to existing customer by phone or creates a new pending customer.
7. Backend creates sms_messages row (direction: inbound).
8. Backend creates communication row linked to customer.
9. SMS appears in customer timeline.

### Outbound SMS Flow

Outbound SMS is v1.1 unless the provider is already selected, the API is straightforward, and commercial and legal rules for Greece are confirmed before v1.

Requirements for outbound (when enabled):
- User must compose the message manually or from a template.
- User must approve send. No auto-send.
- Backend sends via provider API, stores sms_messages row (direction: outbound), stores provider message SID.
- Status callback webhook updates delivery status in sms_messages.

### Phone Normalization

- All phone numbers stored in the database must be E.164 format (for example +306912345678).
- Normalization runs on every inbound webhook, every customer create/update, and every SMS send.
- Greek mobile numbers: +30 prefix, 10 digits.
- A shared normalization utility handles all phone input.

### Customer Matching by Phone

- Before creating a new customer from an inbound call or SMS, normalize the number and query customers by (business_id, phone) or (business_id, mobile_phone).
- If match found: link call or SMS to existing customer.
- If no match: create new customer with status pending, intake_status needs_review.

### CRM Timeline Storage

- Every inbound and outbound communication (call, SMS) has a communication row.
- Customer timeline is built from communications, calls, sms_messages, tasks, offers, and ai_briefs ordered by timestamp.

### Status Callbacks

- Provider sends delivery status updates for outbound SMS.
- Backend updates sms_messages.status on each callback.
- Status is visible in the customer timeline. No user action required.

---

## Legal, Privacy, and Consent Gate

Note: This section describes requirements that must be addressed before production use of any recording or transcription feature. This document does not constitute legal advice. Legal counsel must verify all Greece and EU requirements before any production launch.

### Required Gate Items

- Call recording announcement: script must be reviewed by a lawyer. Announcement must play before recording begins. A consent_events row must be created when the announcement is confirmed played.
- Consent events storage: consent_events table is immutable. Records must not be deleted while the associated recording exists.
- Privacy policy update: must explicitly describe call recording, transcription, AI brief generation, and data retention. Must be live before any recording is enabled.
- DPA with all providers and subprocessors: required for every provider that touches call audio, transcript data, or SMS content. This includes the phone provider, the transcription provider, and the AI model provider. DPAs must be in place before production.
- Retention policy: define how long recordings, transcripts, and briefs are retained. Implement automated deletion at end of retention period.
- Delete and export workflow: customers have the right to request erasure. A workflow must exist to delete recording, transcript, and brief data for a given customer upon request. This includes deletion from provider storage.
- Encrypted recording storage: recordings must be stored with encryption at rest. Provider storage must use server-side encryption. Access via signed URLs only.
- Signed URLs for playback: recording files must never be served via permanent public URL. Use time-limited signed URLs only.
- Recording and transcript access controls: only business owner and authorized users may access recordings and transcripts. RLS enforces this.
- Audit log for recording and transcript access: every access to a recording or transcript (playback, download, API read) must be logged with user ID and timestamp.
- Opt-out behavior: a customer must be able to opt out of recording. The system must respect opt-out and not record calls from opted-out customers.
- Recording off by default: recording must be disabled by default for all new business accounts. The business owner must explicitly enable it after reviewing and accepting the recording consent requirements.
- Legal review before production usage: legal counsel must sign off on the consent announcement text, privacy policy, data retention policy, and DPA list before any production recording begins.

---

## Frontend and App Impact

### AppShell Auth

AppShell must be backend-aware before any voice/SMS features appear in the main app. The AppShell Readiness Gate defined in BACKEND_SPEC.md must be satisfied first.

### Backend-Aware Login

The main /login must handle backend users. Mock login (name only) must not be used for backend accounts. This is a prerequisite for any real CRM or voice features.

### Real Onboarding

Onboarding must create a real Supabase-backed business record, not just a localStorage entry. Voice/SMS features depend on a real business_id.

### Customer Profile Timeline

The customer profile page must be extended to show:
- calls list with status and duration
- transcript view (expandable, lazy loaded)
- AI brief with confirm/edit/dismiss actions
- ai_draft tasks from calls
- SMS messages in chronological order
- all existing offer and task views

### Calls Page

A calls page or section within the main app shows:
- recent calls list
- call status badges
- brief status indicators (pending review, confirmed, dismissed)
- filter by customer, date, status

### Dashboard

Dashboard stats should eventually include:
- calls today
- calls pending brief review
- new inbound SMS

### Tasks

Tasks list must visually distinguish ai_draft tasks from regular tasks. User must be able to confirm or dismiss ai_draft tasks inline.

### Settings: Provider Setup

Settings must include:
- phone number management (provisioned numbers list)
- recording on/off toggle (off by default, gated by consent review)
- call recording announcement text (read only, set by platform after legal review)
- provider status and number status

### Onboarding: Business Phone Setup

Business onboarding should eventually prompt the business owner to set up a phone number as part of the primary flow. This step must come after legal consent review is complete.

### Offer Flow Remains User-Driven

The offer creation flow must not be triggered automatically from a brief. AI brief may propose an offer, but the user must navigate to the offer creation screen and act. No auto-draft offer creation.

---

## Revised Implementation Roadmap

These phases apply specifically to the voice/SMS architecture. They depend on and follow the backend phases in BACKEND_SPEC.md.

### Phase 1: Backend spec and docs update
- Deliverable: VOICE_SMS_ARCHITECTURE.md created. BACKEND_SPEC.md updated to reflect v1 voice/SMS requirement.
- Dependencies: none.
- Blockers: none.

### Phase 2: CRM backend schema and APIs
- Deliverable: customers, tasks, offers, communications tables. CRUD API routes. localStorage becomes secondary.
- Dependencies: Phase 1 (Supabase client) and Phase 2 (auth) from BACKEND_SPEC.md must be complete or in progress.
- Blockers: AppShell Readiness Gate partially blocks main app integration, but API routes can be built independently.

### Phase 3: AppShell auth and backend-aware login
- Deliverable: AppShell reads Supabase session. Main /login handles backend users. All AppShell Readiness Gate items satisfied.
- Dependencies: Phase 2 (CRM schema and APIs).
- Blockers: All AppShell Readiness Gate items listed in BACKEND_SPEC.md.

### Phase 4: Provider abstraction
- Deliverable: src/lib/phone/ modules. PhoneProvider interface. Provider implementations. Signature verification. Event normalization.
- Dependencies: Provider must be selected. Provider developer account must exist.
- Blockers: provider choice not made. Greek number availability unverified. Provider pricing not confirmed.

### Phase 5: Webhook simulation and provider event log
- Deliverable: provider_webhook_events table. All voice/SMS webhook endpoints receiving and storing raw events. Signature verification active. Idempotency on event ID.
- Dependencies: Phase 4 (provider abstraction).
- Blockers: none if using sandbox/test environment. Production requires legal gate.

### Phase 6: Call capture and recording metadata
- Deliverable: calls, call_recordings, business_phone_numbers, consent_events tables. Webhook flow matches call to customer or creates pending customer. Recording metadata stored.
- Dependencies: Phase 5. Phase 2 (CRM schema) for customer matching.
- Blockers: consent announcement must be reviewed by lawyer before recording is enabled in production. Recording stays disabled until legal gate passes.

### Phase 7: Transcription jobs
- Deliverable: call_transcripts table. ai_jobs table. Transcription job runs after recording ready. Transcript stored and linked to call.
- Dependencies: Phase 6. Transcription provider selected and DPA signed.
- Blockers: DPA with transcription provider required. Greek transcription quality must be evaluated in sandbox before production rollout.

### Phase 8: AI brief jobs
- Deliverable: ai_briefs table. AI brief job runs after transcript complete. Brief saved as pending_review. Task confidence scoring. ai_draft tasks created when threshold met.
- Dependencies: Phase 7.
- Blockers: AI model DPA required. Brief JSON schema validated. Confidence threshold calibrated.

### Phase 9: Customer timeline UI
- Deliverable: customer profile extended with calls, transcripts, briefs, ai_draft tasks. Confirm/edit/dismiss brief actions wired to PATCH /api/calls/[id]/brief.
- Dependencies: Phase 8. Phase 3 (AppShell auth).
- Blockers: AppShell Readiness Gate must be satisfied.

### Phase 10: SMS inbound
- Deliverable: sms_messages table. Inbound SMS webhook flow. SMS appears in customer timeline.
- Dependencies: Phase 5 (webhook infrastructure). Phase 4 (provider abstraction).
- Blockers: provider must support SMS. Greek SMS rules and registration requirements must be confirmed.

### Phase 11: Outbound SMS (v1.1)
- Deliverable: POST /api/sms/send route. User-initiated SMS send with manual approval. Delivery status callback.
- Dependencies: Phase 10. Legal rules for outbound SMS confirmed.
- Blockers: outbound SMS requires commercial SMS registration in Greece (sender ID rules apply). Do not build until rules are confirmed.

### Phase 12: Legal and consent gate before production recording
- Deliverable: consent announcement text reviewed and approved. Privacy policy updated. DPA with all subprocessors. Audit log for recording and transcript access. Opt-out mechanism. Retention policy implemented.
- Dependencies: all phases above.
- Blockers: legal counsel must complete review. This phase cannot be skipped for production recording.

### Phase 13: Private beta deployment QA
- Deliverable: end-to-end test with real phone call. Brief appears in CRM within acceptable latency. Task created if confidence threshold met. User can confirm or dismiss brief. No auto-sends, no auto-offers.
- Dependencies: all phases above including Phase 12.
- Blockers: Phase 12 must be complete. Staging environment must mirror production config.

---

## Risks and Unknowns

- Greek number availability: not verified. Major providers may not offer Greek numbers directly. Local carrier partnership or porting may be required.
- Greek SMS rules: sender ID registration rules and commercial SMS requirements for Greece are not confirmed. This may block outbound SMS v1.1.
- Provider pricing: call rates, SMS rates, recording storage, and transcription add-on costs are not evaluated. Verify before selecting provider.
- Recording consent: Greek and EU law requirements for call recording announcement are not fully analyzed. Legal review is required.
- DPA and legal review: no DPAs are in place with any provider. This is a production blocker.
- Transcription quality for Greek: Greek language transcription quality varies by provider and model. Must be tested with real Greek speech before production.
- Noisy job sites: the primary target customer (construction, trades) may have high background noise during calls, degrading transcription quality. Noise-robust transcription models may be needed.
- Latency after call end: recording processing and transcription take time. Brief may not appear for 1 to 5 minutes after call ends. User expectation must be set.
- Webhook retries and duplicates: providers retry webhooks on failure. Idempotency must be robust. Test with simulated duplicate events.
- Retention and deletion: GDPR erasure requests must delete recordings from both platform storage and provider storage. Provider deletion API availability must be verified.
- Fallback if recording fails: recording may fail due to provider error or consent announcement failure. Call should still be logged. User should see call without transcript.
- Fallback if AI fails: transcription or AI brief job may fail. Call and transcript should still be accessible. User should see a failure indicator and be able to trigger retry.
- Mobile and PWA implications: the main app is PWA-friendly. Recording and transcript playback on mobile must be tested. Signed URL audio playback in PWA requires testing.

---

## Open Decisions

- Provider choice: Twilio, Vonage, Telnyx, or a Greek local provider. Decision needed before Phase 4. Greek number availability is the primary constraint.
- Recording after call vs live transcription: recommendation is recording after call for v1. Confirm this decision before Phase 6.
- Transcription provider: OpenAI Whisper, provider-native, or a dedicated multilingual API. Decision needed before Phase 7.
- AI model for brief: which Claude model or other model to use for AI brief generation. Cost per brief must be estimated. Decision needed before Phase 8.
- Recording retention period: how long recordings are retained (for example 30, 90, or 365 days). Must be defined before Phase 12 and documented in the privacy policy.
- Transcript retention period: may differ from recording retention. Define separately.
- Whether outbound SMS is v1 or v1.1: default is v1.1. Revisit if provider and legal situation is resolved before v1 launch.
- Whether provider number is new, forwarded, or ported: a new provider-assigned number keeps setup simple. Number forwarding or porting requires additional coordination. Decide before Phase 4.
- Legal review owner: who is responsible for reviewing the consent announcement, privacy policy, DPAs, and GDPR compliance before production? Must be assigned before Phase 12.

---

*This document is an internal technical reference for the yorgos.ai Voice/SMS architecture.*
*It does not constitute legal advice.*
*Legal counsel must verify all Greece and EU requirements before any production recording or SMS sending begins.*
