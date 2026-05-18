# yorgos.ai Data Model

## Storage approach for MVP

MVP uses local storage only.

No production database, auth, storage or real team sharing.

A minimal backend/API route is allowed only for AI processing so API keys are not exposed in the browser.

## Data principles

- Store only what is needed for the MVP.
- Keep raw audio out of storage.
- Do not store full transcript by default.
- Store only final summary and structured result after user review.
- Keep mock/demo data clearly marked.
- Keep future backend migration in mind, but do not overbuild.

## Entities

### UserProfile

Represents the local mock user.

Fields:

- id
- name
- email
- createdAt
- onboardingCompleted

### BusinessProfile

Represents the professional/business using the app.

Fields:

- id
- businessName
- businessType
- ownerName
- phone
- email
- address
- vatNumber, optional
- taxOffice, optional
- logoDataUrl, local preview only
- defaultVatRate, default 24
- defaultOfferTerms
- defaultAcceptanceText
- createdAt
- updatedAt

Business type values:

- technical_services
- sales_services
- projects_construction
- other

### Workspace

Mock only in MVP.

Fields:

- id
- name
- mode, always mock/local in MVP
- membersPreview, optional mock list

No real team sharing.

### Customer

Represents a CRM contact or company.

Fields:

- id
- name
- companyName, optional
- phone
- email
- address
- source
- opportunityValue
- status
- preferredContactMethod
- businessTypeContext, optional
- needsSummary
- notes
- createdAt
- updatedAt
- lastContactAt
- nextTaskId, optional

Source values:

- facebook_ads
- google_ads
- website_form
- referral
- inbound_call
- missed_call
- manual_entry
- other

Status values:

- new_lead
- contacted
- follow_up_needed
- offer_drafted
- offer_sent
- won
- lost

Preferred contact method values:

- viber
- email
- phone

### CustomerSummary

Stores approved summaries from calls or dictation.

Fields:

- id
- customerId
- sourceType
- sourceId, optional
- summary
- customerNeeds
- nextBestAction
- createdAt
- createdByAi
- userReviewed

Source type values:

- mock_call
- dictation
- manual_note

Important:

Do not store full transcript by default.

### CallRecord

Represents app-level calls in MVP and future VoIP calls.

MVP call records are mock/demo only.

Fields:

- id
- customerId, optional
- phoneNumber
- callType
- direction
- status
- startedAt
- endedAt
- durationSeconds
- isMock
- recordingStatus
- consentStatus
- summaryId, optional
- demoScenarioId, optional
- createdAt

Call type values:

- inbound_new_customer
- inbound_existing_customer
- outbound_new_lead
- outbound_existing_customer
- missed_call

Direction values:

- inbound
- outbound

Status values:

- completed
- missed
- failed
- cancelled

Recording status values:

- not_recorded
- mock_recording
- consented_recording_future

Consent status values:

- not_required_for_mock
- notice_played_future
- consented_future
- declined_future

### DictationCommand

Represents a voice or text command from the user.

Fields:

- id
- inputText
- inputMethod
- detectedIntent
- aiResultId, optional
- createdAt
- processedAt

Input method values:

- speech_to_text
- text_fallback

Detected intent values:

- create_note
- create_task
- create_offer
- update_customer
- change_status
- create_message
- mixed
- unknown

Important:

Input text may be kept only temporarily during the review flow. The final stored data should be the summary and structured result after approval.

### AiResult

Temporary or saved AI output awaiting review.

Fields:

- id
- sourceType
- sourceId
- proposedCustomer
- proposedSummary
- proposedNeeds
- proposedTasks
- proposedOffer
- proposedStatus
- proposedMessages
- warnings
- confidence
- reviewed
- saved
- createdAt

Source type values:

- mock_call
- dictation

Warnings examples:

- customer_uncertain
- amount_uncertain
- date_uncertain
- address_uncertain
- missing_required_info

### Task

Represents a follow-up or action.

Fields:

- id
- customerId
- title
- type
- status
- priority
- dueDate
- dueTime
- note
- relatedCallId, optional
- relatedOfferId, optional
- createdFromAi
- createdAt
- updatedAt
- completedAt, optional

Task type values:

- call_back
- send_offer
- follow_up_offer
- ask_for_photos_documents
- book_appointment
- visit_customer
- wait_for_reply
- other

Task status values:

- open
- due_today
- overdue
- completed
- cancelled

Priority values:

- low
- normal
- high

### Offer

Represents an offer draft or manually marked sent offer.

Fields:

- id
- customerId
- relatedTaskId, optional
- relatedCallId, optional
- offerNumber
- status
- offerDate
- validUntil
- items
- subtotal
- vatRate
- vatAmount
- total
- notes
- terms
- acceptanceText
- viberDraft
- emailDraft
- createdFromAi
- createdAt
- updatedAt

Offer status values:

- draft
- ready_to_send
- sent_manually
- accepted
- rejected
- expired

### OfferItem

Fields:

- id
- description
- quantity
- unitPrice
- lineTotal

### CommunicationDraft

Represents a copyable message.

Fields:

- id
- customerId
- offerId, optional
- taskId, optional
- channel
- subject, optional
- body
- createdFromAi
- createdAt

Channel values:

- viber
- email

### MissedCall

MVP mock entity.

Fields:

- id
- phoneNumber
- customerId, optional
- occurredAt
- status
- autoCreatedTaskId
- isUnknownLead
- createdAt

Status values:

- new
- task_created
- handled
- ignored

### LeadImportPlaceholder

Represents future import direction only.

Fields:

- id
- source
- status
- message

Source values:

- xls_csv
- google_ads_future
- meta_ads_future
- website_form_future

## Relationships

- One Customer has many Tasks.
- One Customer has many Offers.
- One Customer has many CustomerSummaries.
- One Customer has many CallRecords.
- One Offer may be related to one Task.
- One Offer may be related to one CallRecord.
- One Task may be related to one CallRecord or Offer.
- One AiResult may create or update Customer, Tasks, Offer and CommunicationDrafts after review.

## Audio and transcript separation

### Raw audio

MVP:

- Not real.
- Mock only.
- Not stored.

Future:

- Temporary processing artifact.
- Should be deleted quickly after transcription/processing unless explicit retention is configured and legally reviewed.

### Transcript

MVP:

- Demo transcripts can exist in code as mock data.
- User dictation text can exist temporarily for processing.
- Do not store full transcript as final CRM data.

Future:

- Transcript may be temporary or optionally retained only if legally reviewed and clearly disclosed.

### Summary

Stored after user review.

### CRM data

Stored after user review.

### Offer

Stored after user review.

## Local storage structure suggestion

Use one local storage namespace, for example:

yorgos_ai_mvp_state

Suggested shape:

```json
{
  "userProfile": {},
  "businessProfile": {},
  "workspace": {},
  "customers": [],
  "tasks": [],
  "offers": [],
  "calls": [],
  "missedCalls": [],
  "summaries": [],
  "communicationDrafts": [],
  "settings": {}
}
```

## Future backend notes

When moving beyond MVP, likely backend needs:

- Real auth
- Business/workspace table
- Team members
- Customers
- Tasks
- Offers
- Call records
- AI processing logs
- Consent logs
- Audio processing jobs
- File storage for logos and PDFs
- Audit trail for sensitive changes

Do not build this in MVP unless explicitly approved.

## Backend v2 direction

The v2 backend direction is documented in `BACKEND_SPEC.md` at the project root.

That document defines the recommended stack, production schema, auth plan, migration plan, email sending foundation, lead intake foundation, business phone foundation, privacy boundaries, and phased roadmap.

This data model document remains the MVP localStorage reference. For backend implementation decisions, use `BACKEND_SPEC.md`.
