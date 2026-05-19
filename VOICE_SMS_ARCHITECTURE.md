# yorgos.ai Voice/SMS Architecture

## Status

- Not implemented yet (full voice pipeline and production Viber delivery).
- Required for working private beta v1.
- Backend foundation exists, but voice capture, recording, transcription, AI brief pipeline, CRM timeline, Viber intake link delivery, and provider integration are not implemented yet.
- Voice provider strategy changed. See the Voice Provider Strategy section below.
- Telnyx is paused as primary Greek number provider. Greek number purchase requires heavier verification and available numbers are limited.
- Inter Telecom is now the primary Greek number/SIP candidate for v1. Inter Telecom integration is not implemented yet.
- Apifon is the primary Viber/intake delivery provider for first implementation tests.
- Apifon production sender ("Yorgos AI" or equivalent approved name) is not activated yet. Current access is account-provided test/free access with sender "Apifon Demo" and cap limit 20.
- Provider availability, Greek numbers, Viber Business approval, SMS rules, pricing, DPA, and legal consent must be verified before production.
- Viber intake link delivery is planned for v1 as the primary post-call messaging channel.
- Viber provider approval, one-way mode, template/link rules, delivery reports, pricing, and DPA must be verified before production.
- SMS is no longer the primary v1 intake channel. SMS is fallback/v1.1.

---

## v1 Product Requirement

Business phone must feed the CRM automatically via automatic call transcription and AI brief. After a call brief, if required customer fields are missing, the system delivers a secure intake link via Viber. Manual call logging is not required for the core flow.

Requirements:
- Every business managed by yorgos.ai must be able to receive calls through a provider-managed number that routes to the CRM.
- When a call ends, the system must retrieve the recording and transcribe it without manual action by the user.
- The backend generates an AI brief from the transcript and saves it automatically as pending review.
- No manual call summary is required for the core flow. The brief is ready for the user to review, edit, confirm, or dismiss.
- Task creation from a call is allowed only as ai_draft status and only when confidence and next action are clear.
- After AI brief, if required customer fields are missing, the backend creates a secure customer intake link.
- The intake link is delivered via Viber using a central approved business sender (for example "Yorgos AI").
- The professional's name appears inside the Viber message body as a dynamic signature, not as the sender name.
- Customer replies via Viber are not handled in v1.
- Offers must not be auto-created from a brief. The user must initiate offer creation.
- Viber message send must not be auto-sent without user confirmation in v1 unless provider approval and legal rules are confirmed. See the Viber Intake Link Delivery section.
- Customer status changes proposed by AI must be confirmed by the user before taking effect.
- SMS is fallback/v1.1, not the primary v1 messaging channel.

---

## End-to-End Call-to-CRM Flow

1. Business owner provisions or registers a provider-managed phone number for their account.
2. An incoming call arrives on that number.
3. A consent announcement plays before recording begins (required by applicable law).
4. Call is connected to the business owner's device and recorded if consent rules allow it.
5. Call ends.
6. Provider or PBX/SIP middleware sends a call completed event and a recording-ready event when the recording is available. The event source depends on the voice architecture mode (CPaaS programmable provider or SIP/PBX middleware layer).
7. Backend receives the event and stores the raw provider event idempotently using the provider event ID.
8. Backend matches the caller phone number (normalized to E.164) against existing customers, or creates a new customer record with status pending.
9. Backend creates a call record and a communication record linked to that customer.
10. Backend stores recording metadata (duration, provider recording ID, consent status, not raw audio yet).
11. Backend downloads or references the recording file for the transcription job.
12. Transcription job runs asynchronously: audio is submitted to the transcription provider, result is stored in call_transcripts.
13. AI brief job runs after transcript is ready: transcript is submitted to the AI model, structured brief is generated.
14. Brief is saved to the CRM as ai_brief with status pending_review.
15. ai_draft tasks are created automatically only when confidence score meets threshold and next action is unambiguous.
16. Brief is checked for missing required customer fields (name, email, address, or other configured fields).
17. If missing fields are detected, backend creates a customer_intake_link with a secure token, expiry, and references to business_id, customer_id, call_id, ai_brief_id, and phone_e164.
18. Backend prepares a Viber message with the intake link and a dynamic professional signature. The message does not include sensitive AI brief content.
19. Viber message is queued or sent via the central approved business sender, subject to user confirmation rules for v1 (pending provider approval).
20. Customer opens the intake link, fills in the required fields, and submits the form.
21. Backend validates the submission, updates the customer profile, and writes a timeline activity record.
22. User opens the customer timeline and sees the call, transcript, AI brief, draft tasks, and intake link status.

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

## Voice Provider Strategy: Inter Telecom First

### Reason for pivot from Telnyx

Telnyx offered Greek local numbers at $1/month and has good EU infrastructure. However, during first testing:
- Greek number purchase on Telnyx requires identity verification and business documentation.
- Available Greek numbers in the Telnyx portal were limited at the time of testing.
- Verification friction makes Telnyx a poor fit for quick v1 private beta setup.

Telnyx remains useful as a programmable voice test route and may be reconsidered for later phases or as a CPaaS fallback. The Telnyx webhook endpoint at `/api/webhooks/voice/telnyx` was implemented for provider testing and is kept for that purpose.

### Inter Telecom expected role

Inter Telecom is a Greek telecoms provider the user already uses. This gives:
- Easier access to Greek numbers (existing customer relationship).
- More available Greek numbers.
- Local support and local carrier knowledge.
- Lower regulatory friction for a Greek-registered or Greek-operating business.

Inter Telecom is expected to provide:
- Greek phone number (local or mobile).
- SIP trunk for our PBX layer to connect to.

Inter Telecom does not appear to offer a CPaaS-style programmable webhook API based on public documentation. Confirm with Inter Telecom before implementing any API integration.

### Our system expected role (SIP/PBX middleware mode)

In this mode, our backend acts as a PBX layer between the SIP trunk and the professional's mobile phone:

1. Incoming call arrives on the Inter Telecom SIP trunk.
2. PBX answers the call, plays a consent announcement, and bridges the call to the professional's mobile.
3. PBX records the call (if consent rules allow).
4. Call ends.
5. PBX produces a call-completed event and a recording-ready event.
6. Backend receives the event, processes it, and runs the transcription and AI brief pipeline.
7. CRM is updated.

PBX options being evaluated (not selected yet):
- Asterisk or FreePBX (self-hosted, full control, significant ops burden).
- FreeSWITCH (flexible, developer-friendly, self-hosted).
- Managed PBX with API/webhook (reduces ops burden but may limit control).

### What must be confirmed with Inter Telecom before implementation

- SIP trunk availability and onboarding process.
- Recording rights: does the SIP trunk allow our PBX to record audio?
- Outbound forwarding: can the SIP trunk forward calls to external Greek mobile numbers?
- Concurrent call limits for the SIP trunk.
- Caller ID behavior when forwarding to professional mobile (does the caller's number pass through?).
- Data Processing Agreement (DPA) availability.
- Per-minute and monthly costs.
- Technical contact for SIP trunk configuration.

### PBX hosting and operational requirements

- PBX must be hosted on a server with a public IP, TLS, and SRTP for secure SIP.
- NAT/firewall rules must allow SIP traffic.
- Recording files produced by PBX must be stored securely and accessible to the backend for transcription.
- PBX logs and events must be forwarded to the backend webhook endpoint.
- Ops burden for PBX maintenance must be factored into v1 timeline.

Do not build PBX infrastructure until Inter Telecom SIP trunk feasibility is confirmed.

---

## Provider Abstraction

Provider-specific code must not be scattered across the codebase. All provider interaction must go through a normalized abstraction layer.

Two possible voice modes are supported by the abstraction design:

Mode 1: CPaaS programmable voice provider (for example Telnyx). Provider sends webhooks directly to the backend with signature headers. This is the classic programmable voice pattern.

Mode 2: SIP/PBX middleware mode. A Greek SIP provider (for example Inter Telecom) provides a SIP trunk. Our system acts as a PBX layer (using Asterisk, FreePBX, FreeSWITCH, or similar) to bridge calls, forward to the professional's mobile, record, and post a call-completed event to the backend after the call ends.

Both modes normalize to the same internal event format before business logic runs.

Requirements:
- Normalize provider events to a shared internal event format before any business logic runs.
- Verify webhook signatures before processing any event. Reject unsigned or invalid webhooks with 401.
- Store every raw provider event in provider_webhook_events before processing. This allows replay and audit.
- Use idempotency keyed on provider event ID. If the same event arrives twice, do not process it twice.
- Implement retry handling for downstream jobs. Provider will retry webhooks on 5xx. Handle gracefully.

Proposed module structure (these files are proposed, not implemented):

- `src/lib/phone/types.ts`: shared types: NormalizedCallEvent, NormalizedSmsEvent, CallStatus, ProviderEvent
- `src/lib/phone/provider.ts`: PhoneProvider interface definition
- `src/lib/phone/telnyx.ts`: Telnyx CPaaS implementation, signature verification, event normalization
- `src/lib/phone/sip.ts`: SIP/PBX middleware interface and event adapter
- `src/lib/phone/pbx.ts`: PBX recording/event helpers for self-managed or managed PBX integration
- `src/lib/phone/normalize.ts`: maps provider-specific fields to NormalizedCallEvent and NormalizedSmsEvent
- `src/lib/phone/signatures.ts`: signature verification utilities, provider-specific HMAC/header logic

These files are proposed, not implemented. The Telnyx webhook endpoint at `/api/webhooks/voice/telnyx` is implemented for provider testing but does not mean Telnyx is selected for v1. Telnyx is paused as primary Greek number provider until number availability and verification friction are resolved.

---

## Database Model Proposal

All tables follow the existing RLS pattern: business_id on every row, policy enforces access via business_users. Do not write full SQL yet.

### customers (Phase 3, extended for voice)

- Purpose: CRM contacts. Must include phone and mobile_phone for call/SMS matching.
- Essential additions for voice: phone (E.164 normalized), mobile_phone (E.164), intake_status.
- Relationships: linked to calls, communications, sms_messages, tasks, ai_briefs, customer_intake_links.
- RLS: business_members_only.
- Indexes: (business_id, phone), (business_id, mobile_phone), (business_id, email).
- v1 required.

### communications (Phase 3, extended for voice)

- Purpose: Outbound/inbound communication log. Entries for calls, SMS, email.
- Essential columns: id, business_id, customer_id, channel (call/sms/viber/email), direction (inbound/outbound), status, phone, summary, created_at.
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

### sms_messages (Phase 6, fallback/v1.1)

- Purpose: Inbound and outbound SMS log. SMS is fallback/v1.1. Not the primary v1 intake channel.
- Essential columns: id, business_id, customer_id, communication_id, provider, provider_message_sid, direction, from_number, to_number, body, status, sent_at, delivered_at, created_at.
- Relationships: customers, communications.
- RLS: business_members_only.
- Indexes: (business_id, customer_id), (business_id, from_number).
- v1.1 (fallback only). Not required for core v1.

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

### customer_intake_links (Phase 8, after AI brief)

- Purpose: Secure one-time intake links created after an AI brief detects missing customer fields.
- Essential columns: id, business_id, customer_id, call_id, ai_brief_id, phone_e164, token (secure random, unique), status (pending/sent/opened/submitted/expired/revoked), expires_at, created_at, sent_at, opened_at, submitted_at.
- Relationships: businesses, customers, calls, ai_briefs.
- RLS: business_members_only for authenticated read/update. Public read via token only (token is the auth for the public intake form, no Supabase session required).
- Indexes: (business_id, customer_id), (token) unique, (status), (expires_at).
- v1 required.

### customer_intake_submissions (Phase 8, after AI brief)

- Purpose: Stores the data submitted by the customer via the public intake form.
- Essential columns: id, intake_link_id, business_id, customer_id, submitted_fields (jsonb), ip_address_hash, submitted_at.
- Relationships: customer_intake_links, customers.
- RLS: business_members_only for read. Service role for write (form submission is unauthenticated but processed server-side).
- Indexes: (business_id, customer_id), (intake_link_id).
- v1 required.

### viber_messages (Phase 9, Viber intake delivery)

- Purpose: Log of Viber messages sent from the platform for intake link delivery.
- Essential columns: id, business_id, customer_id, intake_link_id, provider, provider_message_id, to_number, body_template, status (queued/sent/delivered/seen/failed), sent_at, delivered_at, seen_at, error_message, created_at.
- Relationships: businesses, customers, customer_intake_links.
- RLS: business_members_only.
- Indexes: (business_id, customer_id), (intake_link_id), (provider_message_id).
- v1 required (outbound send). Inbound Viber replies not stored in v1.

---

## API and Webhook Proposal

### Provider Webhooks

| Method + Path | Purpose | Auth/Security | Idempotency | v1 Required |
|---|---|---|---|---|
| POST /api/webhooks/voice/telnyx | Telnyx Voice webhook receiver (implemented, provider test only, no DB writes) | Ed25519 signature verified | Idempotent on provider event ID | Provider test only |
| POST /api/webhooks/apifon/status | Apifon Viber delivery/status callback (implemented, provider test only, no DB writes) | Optional shared secret | Idempotent on request_id + message_id | Provider test only |
| POST /api/webhooks/voice/inbound | Generic CPaaS provider: incoming call notification | Provider signature header verified | Store raw event, check provider event ID | Yes (proposed) |
| POST /api/webhooks/voice/status | Generic CPaaS provider: call status updates | Provider signature verified | Idempotent on provider event ID | Yes (proposed) |
| POST /api/webhooks/voice/recording | Generic CPaaS provider: recording ready notification | Provider signature verified | Idempotent on recording SID | Yes (proposed) |
| POST /api/webhooks/voice/transcription | Provider-native transcription ready (if used) | Provider signature verified | Idempotent on transcription ID | Optional |
| POST /api/webhooks/voice/pbx/call-completed | PBX middleware: call ended event with metadata | Internal PBX secret or IP allowlist | Idempotent on call ID | Yes if PBX mode (proposed) |
| POST /api/webhooks/voice/pbx/recording-ready | PBX middleware: recording file available for download | Internal PBX secret or IP allowlist | Idempotent on recording ID | Yes if PBX mode (proposed) |
| POST /api/webhooks/sms/inbound | Inbound SMS received | Provider signature verified | Idempotent on message SID | v1.1 fallback |
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
| GET /api/sms | List SMS messages | Bearer token, business scope | N/A | v1.1 fallback |
| POST /api/sms/send | Send outbound SMS | Bearer token, user-approved only | Idempotent on message ID | v1.1 |
| POST /api/customer-intake-links | Create intake link for customer after AI brief | Bearer token, business scope | Idempotent on (customer_id, call_id) | Yes |
| GET /api/customer-intake/[token] | Public intake form: load customer fields by token | Token auth only (no Bearer required) | N/A | Yes |
| POST /api/customer-intake/[token] | Public intake form: submit customer fields | Token auth only (no Bearer required) | Idempotent on token (one-time use) | Yes |
| POST /api/viber/send-intake-link | Send Viber message with intake link | Bearer token, business scope | Idempotent on intake_link_id | Yes |
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
  "missing_customer_fields": ["name | email | address | phone"],
  "intake_recommended": true,
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
- Outbound Viber or SMS messages: never auto-sent in v1 without user confirmation. Automatic send requires Viber provider approval, approved template, and legal confirmation.
- Customer status changes: proposed in brief JSON only, never applied automatically.

### Intake Link Creation

- AI output may include missing_customer_fields (list of field names) and intake_recommended (boolean).
- The AI does not decide to send a Viber message. That decision is a product-level rule, not an AI decision.
- System may auto-create a customer_intake_link when missing_customer_fields is non-empty and the call has a valid customer phone number.
- Viber message send is manual approval in v1 by default. Automatic send requires Viber provider approval, approved message template, and explicit product decision to enable.
- No sensitive call summary text or transcript content may be included in the Viber message body.

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

## Viber Intake Link Delivery

Viber is the primary v1 channel for delivering customer intake links after an AI call brief. Viber is not implemented yet. Provider approval and DPA are required before production.

### Sender

- One central approved Viber Business sender is used for all messages from the platform.
- Suggested sender name: "Yorgos AI" or an equivalent platform-level approved name.
- The professional's name (for example "Μανώλης Μαραγκός") appears inside the message body as a dynamic signature, not as the Viber sender ID.
- The message must clearly state it is sent by Yorgos AI on behalf of the named professional.

### Message Rules

- The message must contain a clear "sent on behalf of" statement.
- The message must include the secure intake link.
- The message must include a dynamic professional signature at the end.
- No sensitive AI brief content (call summary, transcript excerpts, financial details) may appear in the message body.
- One-way send is the desired v1 mode. If the provider supports one-way only, use it. If not, incoming replies must be ignored or bounced with an automated notice.
- Customer replies are not handled in v1.

### Example Message (Greek)

```
Καλησπέρα, είμαι το Yorgos AI και σας στέλνω αυτό το link εκ μέρους του/της Μανώλης Μαραγκός.

Για να συμπληρωθεί σωστά η καρτέλα σας, παρακαλώ βάλτε τα στοιχεία σας εδώ:
https://app.yorgos.ai/customer-intake/example-token

Φιλικά,
Μανώλης Μαραγκός
```

This example is for reference only. The actual message template must be approved by the Viber provider and reviewed before production use.

### Delivery and Seen Reports

- Store delivery and seen reports if the provider supports them.
- Update viber_messages.status on each status webhook callback.
- Seen status is optional but useful for intake link follow-up logic.

### Secure Token Link

- Each intake link is a one-time-use secure token.
- Token is bound to business_id, customer_id, call_id, ai_brief_id, and phone_e164.
- Token has a configurable expiry (for example 48 or 72 hours from creation).
- Expired tokens return a clear message to the customer.
- Submitted tokens are not reusable.
- The intake form at the token URL does not require Supabase auth. The token itself is the auth.
- Token is generated server-side with a cryptographically secure random value.

### Send Behavior in v1

- Manual approval mode: user sees the prepared Viber message in the app, reviews it, and clicks send.
- Automatic mode: system sends immediately after brief is created, without user action. Automatic mode requires Viber provider approval, legal review of the message template, and an explicit product decision to enable.
- Default for v1: manual approval. Automatic mode is a later configuration option.

### Fallback

- If Viber send fails (provider error, recipient not reachable), log the failure in viber_messages with status failed.
- The intake link URL is always available to copy and share manually from the app.
- SMS fallback: if SMS provider is configured and Viber fails, system may attempt SMS delivery. SMS fallback is v1.1 unless confirmed before v1 launch.

### Provider Approval and DPA

- Viber Business sender must be approved by the Viber provider before sending.
- Approval process includes business verification, use case review, and template approval.
- A DPA with the Viber provider is required before production.
- Provider approval status is not verified. This is a production gate.

### Yuboto as Backup Provider

Yuboto is a viable backup Viber provider. Notes confirmed:
- One-way messaging is possible if the account is opened as one-way from the start.
- Delivery and seen/read reports are supported.
- DPA is available if cooperation proceeds.
- No setup fee.
- Transactional message templates do not allow dynamic link values in dynamic template fields. If using Yuboto for intake link delivery, a workaround is required: place a static base URL in the template and append a dynamic access code as a query parameter so the full token URL is not placed in a dynamic field.
- This workaround must be confirmed with Yuboto before selecting it for v1.

---

## Apifon Viber Intake Delivery Status

Apifon is the primary Viber/intake delivery provider for first implementation tests. The following results have been manually confirmed.

### Confirmed test results (manual testing)

- OAuth client credentials flow: works.
- `POST https://ars.apifon.com/services/api/v1/im/send`: works.
- Sender used in test: "Apifon Demo".
- Access type: account-provided free/test access. Cap limit: 20 messages.
- Greek UTF-8 in message body: works when request body is sent as UTF-8.
- Plain URL inside Viber text: works and is clickable by the recipient.
- `callback_url` parameter: works. Apifon delivers status callbacks to the configured URL.

### Confirmed callback payload shape

The real Apifon status callback is a JSON object:

```json
{
  "request_id": "string",
  "data": [
    {
      "from": "sender name",
      "to": "recipient phone",
      "message_id": "string",
      "custom_id": "your reference",
      "status": { "code": 10, "text": "seen" },
      "price": "0.025",
      "vat": "0",
      "timestamp": 1234567890,
      "metadata": {}
    }
  ],
  "account_id": 12345,
  "type": "VIBER"
}
```

Fields confirmed present:
- `request_id`, `account_id`, `type` at root.
- `data[0].from`, `data[0].to`, `data[0].message_id`, `data[0].custom_id`.
- `data[0].status.code`, `data[0].status.text`.
- `data[0].price`, `data[0].vat`, `data[0].timestamp`.

### Implemented provider-test endpoints

Two minimal provider-test endpoints are implemented:
- `GET /api/webhooks/apifon/status` (health check)
- `POST /api/webhooks/apifon/status` (receives and acknowledges Apifon callbacks, parses confirmed payload shape, returns summary)

These are provider-test endpoints only. No database persistence yet. Full Viber message persistence and send abstraction come in a later phase.

### What remains required before production

- Production Viber sender activation (sender "Yorgos AI" or equivalent approved name). Not yet activated.
- DPA with Apifon.
- Pricing confirmation beyond test access.
- Legal review of consent/opt-in model for Viber messaging.
- Template/link policy confirmed for production sender.

---

## Messaging Capture Plan

Viber is the primary v1 channel for intake link delivery. SMS is fallback/v1.1 and is not the core v1 intake channel. Inbound Viber replies are not handled in v1. Inbound SMS is not core v1 unless the provider decision changes.

### Inbound SMS Flow (fallback/v1.1)

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
- AI brief with confirm/edit/dismiss actions, and missing fields indicator if brief detects them
- intake link status badge and send/copy action on AI brief card
- ai_draft tasks from calls
- Viber message sent events in the customer timeline
- intake link submission events in the customer timeline
- SMS messages in chronological order (fallback/v1.1)
- all existing offer and task views

### Customer Profile: Intake Link Card

- When an AI brief includes missing_customer_fields, the brief card shows which fields are missing.
- Button: "Create intake link" triggers POST /api/customer-intake-links.
- Button: "Send via Viber" (direct send mode) or "Copy Viber message" (manual copy mode), depending on the v1 send behavior configured.
- Intake link status badge: pending, sent, opened, submitted, expired, revoked.
- Customer timeline shows when the intake link was sent and when the customer submitted the form.
- Public intake form collects: name, surname, address, email (configurable per business).

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
- intake links pending submission
- new inbound Viber messages (v1.1 if replies are handled)
- new inbound SMS (v1.1 fallback)

### Tasks

Tasks list must visually distinguish ai_draft tasks from regular tasks. User must be able to confirm or dismiss ai_draft tasks inline.

### Settings: Provider Setup

Settings must include:
- phone number management (provisioned numbers list)
- recording on/off toggle (off by default, gated by consent review)
- call recording announcement text (read only, set by platform after legal review)
- Viber intake delivery settings: enable/disable, sender name display
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

### Phase 4: Voice provider and PBX/SIP feasibility
- Deliverable: Inter Telecom SIP trunk feasibility confirmed (SIP trunk details, recording rights, forwarding rights, concurrent call limits, DPA, costs). PBX/SIP middleware mode vs CPaaS mode decision made. src/lib/phone/ module structure defined (types, interface, SIP/PBX adapter, normalize).
- Dependencies: Direct contact with Inter Telecom technical team.
- Blockers: Inter Telecom technical confirmation not received. Do not build more Telnyx-specific code or PBX infrastructure until this phase is resolved. The Telnyx test webhook endpoint is sufficient for CPaaS pattern testing in the meantime.
- Next step: Contact Inter Telecom, confirm SIP trunk access, recording rights, and forwarding capabilities.

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

### Phase 8: AI brief jobs and customer intake link schema
- Deliverable: ai_briefs table. AI brief job runs after transcript complete. Brief saved as pending_review. Task confidence scoring. ai_draft tasks created when threshold met. customer_intake_links and customer_intake_submissions tables. POST /api/customer-intake-links route. Public intake form routes GET /api/customer-intake/[token] and POST /api/customer-intake/[token].
- Dependencies: Phase 7.
- Blockers: AI model DPA required. Brief JSON schema validated. Confidence threshold calibrated.

### Phase 9: Viber intake link delivery (v1 messaging, Apifon)
- Deliverable: viber_messages table. POST /api/viber/send-intake-link route. Apifon send abstraction (proposed: src/lib/viber/apifon.ts). Delivery/status persistence wired to the confirmed Apifon callback shape. Manual approval UI for reviewing and sending the Viber intake link message from the brief card.
- Dependencies: Phase 8. Apifon production sender activated and approved. DPA with Apifon signed. Message template confirmed with provider.
- Blockers: Apifon production sender not yet activated (current access is test/free, cap limit 20). DPA not signed. Template approval status unknown. Legal review of consent model required before production messaging.
- Note: Apifon OAuth and test send are confirmed working. The status webhook at /api/webhooks/apifon/status is implemented for provider testing. Next Viber step is persistence and send abstraction after docs update.

### Phase 10: Customer timeline UI
- Deliverable: customer profile extended with calls, transcripts, briefs, ai_draft tasks, and intake link status. Confirm/edit/dismiss brief actions wired to PATCH /api/calls/[id]/brief. Intake link create and send actions visible on brief card.
- Dependencies: Phase 8. Phase 3 (AppShell auth).
- Blockers: AppShell Readiness Gate must be satisfied.

### Phase 11: SMS inbound (v1.1 fallback)
- Deliverable: sms_messages table. Inbound SMS webhook flow. SMS appears in customer timeline. SMS is fallback/v1.1 only.
- Dependencies: Phase 5 (webhook infrastructure). Phase 4 (provider abstraction).
- Blockers: provider must support SMS. Greek SMS rules and registration requirements must be confirmed.

### Phase 12: Outbound SMS (v1.1)
- Deliverable: POST /api/sms/send route. User-initiated SMS send with manual approval. Delivery status callback.
- Dependencies: Phase 11. Legal rules for outbound SMS confirmed.
- Blockers: outbound SMS requires commercial SMS registration in Greece (sender ID rules apply). Do not build until rules are confirmed.

### Phase 13: Legal and consent gate before production recording and Viber messaging
- Deliverable: consent announcement text reviewed and approved. Privacy policy updated. DPA with all subprocessors including Viber provider. Audit log for recording and transcript access. Opt-out mechanism. Retention policy implemented.
- Dependencies: all phases above.
- Blockers: legal counsel must complete review. This phase cannot be skipped for production recording or Viber messaging.

### Phase 14: Private beta deployment QA
- Deliverable: end-to-end test with real phone call. Brief appears in CRM within acceptable latency. Task created if confidence threshold met. Customer intake link created. Viber message sent via manual approval. Customer opens intake form and submits. Customer profile updated. User can confirm or dismiss brief. No auto-sends, no auto-offers.
- Dependencies: all phases above including Phase 13.
- Blockers: Phase 13 must be complete. Staging environment must mirror production config.

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
- Viber Business approval: the application process for a Viber Business sender is not started. Approval timeline is unknown and may be a private beta blocker.
- Viber one-way mode availability: not all Viber provider APIs guarantee one-way messaging. Incoming replies must be handled or suppressed if one-way is not supported.
- Viber template and link rules: Viber may have restrictions on sending links or on message template content. These must be verified with the provider before implementation.
- Viber delivery report availability: delivery and seen reports are not guaranteed for all Viber provider tiers. Availability must be confirmed before building status update logic.
- Viber pricing: per-message costs for Viber Business are not evaluated. Verify before selecting provider and before enabling automatic send.
- Customer trust when sender is Yorgos AI: customers receiving a Viber message from "Yorgos AI" on behalf of a professional may be skeptical. Message copy and brand positioning must be considered before launch.
- Opt-out and consent for Viber messaging: GDPR and Greek law may require consent before sending unsolicited business messages via Viber. Legal review is required before production.
- Fallback if Viber is unavailable: if the customer does not have Viber installed, the message will not be delivered. SMS fallback or manual intake link copy must be available as alternatives.
- Inter Telecom may not provide programmable webhooks: public documentation suggests SIP/PBX orientation, not a CPaaS-style webhook API. A self-managed PBX layer may be required. This adds significant infrastructure and ops complexity.
- PBX infrastructure risks: self-managed PBX (Asterisk/FreePBX/FreeSWITCH) requires a stable server with public IP, SIP/TLS/SRTP configuration, NAT/firewall setup, and ongoing maintenance. A hosted or managed PBX reduces ops burden but may limit recording and event control.
- Caller ID when forwarding to professional mobile: forwarding via a PBX/SIP layer may alter caller ID display on the professional's mobile. This affects caller identification and trust. Must be tested.
- Concurrent call limits: Inter Telecom SIP trunk concurrent call capacity is not confirmed. Must verify before production.
- Recording consent announcement via PBX: the consent announcement must play before recording starts, driven by PBX logic. This must be designed before PBX implementation.
- Apifon cap limit 20 for current test sender: "Apifon Demo" sender is limited to 20 messages on the current test access. Do not exhaust this for non-essential tests.
- Apifon production sender activation: pending. Timeline is unknown. This blocks production Viber intake delivery.

---

## Open Decisions

- Voice provider/PBX architecture: Inter Telecom is the current primary candidate for Greek number/SIP. Telnyx is paused. A decision on Inter Telecom SIP trunk feasibility and PBX architecture (Asterisk/FreePBX/managed PBX/CPaaS) must be made before Phase 4. If Inter Telecom is not viable, revisit Telnyx or a managed PBX service with Greek number support.
- PBX mode vs CPaaS mode: decide between self-managed SIP/PBX (more ops, more control) and CPaaS programmable voice (less ops, less control, higher per-minute cost). Decide after Inter Telecom feasibility is confirmed.
- Recording after call vs live transcription: recommendation is recording after call for v1. Confirm this decision before Phase 6.
- Transcription provider: OpenAI Whisper, provider-native, or a dedicated multilingual API. Decision needed before Phase 7.
- AI model for brief: which Claude model or other model to use for AI brief generation. Cost per brief must be estimated. Decision needed before Phase 8.
- Recording retention period: how long recordings are retained (for example 30, 90, or 365 days). Must be defined before Phase 12 and documented in the privacy policy.
- Transcript retention period: may differ from recording retention. Define separately.
- Whether outbound SMS is v1 or v1.1: default is v1.1. Revisit if provider and legal situation is resolved before v1 launch.
- Whether provider number is new, forwarded, or ported: a new provider-assigned number keeps setup simple. Number forwarding or porting requires additional coordination. Decide before Phase 4.
- Legal review owner: who is responsible for reviewing the consent announcement, privacy policy, DPAs, and GDPR compliance before production? Must be assigned before Phase 13.
- Viber provider choice: Apifon is the current primary candidate (OAuth and test send confirmed). Yuboto is the backup (one-way confirmed, but dynamic link workaround required). Infobip is enterprise fallback. Confirm Apifon production sender activation, DPA, and pricing before committing to Apifon for v1 production.
- Viber one-way only vs replies webhook: if the provider supports replies, decide whether to implement a webhook handler or ignore/bounce replies in v1.
- Central sender name: confirm "Yorgos AI" or another platform-level name for the Viber sender. Must match the name approved in the Viber provider application.
- Template approval requirements: confirm whether the Viber provider requires pre-approved message templates for messages containing links. Affects Phase 9 deliverables.
- Manual copy vs automatic Viber send for v1: default is manual approval. Decide whether automatic send can be enabled for v1 after provider approval and legal review, or whether it is strictly v1.1.
- SMS fallback timing: decide whether SMS fallback for Viber failures is v1 or v1.1. Default is v1.1.

---

*This document is an internal technical reference for the yorgos.ai Voice/SMS architecture.*
*It does not constitute legal advice.*
*Legal counsel must verify all Greece and EU requirements before any production recording, Viber messaging, or SMS sending begins.*
