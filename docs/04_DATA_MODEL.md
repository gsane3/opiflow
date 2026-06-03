# deskop.ai Data Model

Last refreshed: 2026-05-24
Current model: backend/Supabase pilot first. LocalStorage is no longer the source of truth for live pilot features.

## Storage direction

Live pilot:
- Supabase-backed data
- authenticated business/user context
- backend API routes
- provider webhooks
- public token flows
- audit/timeline records

Local/demo storage:
- should not be used for new live features
- old local/demo code may exist temporarily
- product direction is to remove demo/local surfaces fully

## Data principles

- Store only what is needed.
- Do not expose secrets in client code.
- Do not store raw public tokens.
- Do not show full transcripts by default.
- Prefer short call brief over transcript.
- Keep raw audio only as long as required for processing, legal and product needs.
- Review AI output before final save or send by default.
- Track provider sends and failures.
- Keep tenant/business isolation strict.
- Write timeline/audit events for important changes.

## Core entities

### UserProfile

Represents an app user.

Fields:
- id
- email
- name
- createdAt
- updatedAt
- defaultBusinessId
- role, later

### Business

Represents the professional or company.

Fields:
- id
- name
- ownerName
- sectorProfileId
- phone
- email
- address
- vatNumber
- taxOffice
- defaultVatRate
- defaultOfferTerms
- defaultAcceptanceText
- workingHours
- createdAt
- updatedAt

### SectorProfile

Represents a business category.

Fields:
- id
- key
- name
- description
- defaultTaskTypes
- defaultOfferTerms
- customerFields
- messageTemplates
- aiPromptContext
- enabledFeatures

Initial keys:
- technical_services
- sales_services
- construction_projects
- real_estate
- accounting
- spare_parts
- medical
- takeaway
- other

### PhoneNumber

Represents a managed or connected business number.

Fields:
- id
- businessId
- provider
- numberMasked
- status
- type
- routingMode
- supportsRecording
- supportsCallerIdPassthrough
- createdAt
- updatedAt

Type values:
- managed_new_number
- forwarded_existing_number
- ported_number_future

Important:
- Caller ID passthrough for forwarding must not be assumed until tested.

### Customer

Represents a client, lead or company.

Fields:
- id
- businessId
- crmNumber
- name
- companyName
- phone
- mobilePhone
- landlinePhone
- email
- address
- source
- status
- opportunityValue
- preferredContactMethod
- needsSummary
- notes
- intakeStatus
- lastContactAt
- nextTaskId
- createdAt
- updatedAt

Status examples:
- new_lead
- contacted
- follow_up_needed
- offer_drafted
- offer_sent
- appointment_pending
- won
- lost
- rejected

### Communication

Represents calls, emails, Viber messages, WhatsApp messages, SMS or other communications.

Fields:
- id
- businessId
- customerId
- channel
- direction
- provider
- providerEventId
- status
- subject
- bodyPreview
- occurredAt
- metadata
- createdAt

Channel values:
- call
- email
- viber
- whatsapp
- sms
- web_form
- internal_note

Direction values:
- inbound
- outbound

### Call

Can be stored as a communication with channel `call`, or as a separate normalized call table later.

Fields:
- id
- businessId
- customerId
- phoneNumber
- direction
- status
- startedAt
- endedAt
- durationSeconds
- recordingStatus
- recordingPath
- consentStatus
- providerCallId
- createdAt

### CallBrief

Stores AI summary from a call.

Fields:
- id
- businessId
- customerId
- communicationId
- callId
- brief
- customerNeeds
- nextBestAction
- warnings
- aiModel
- userReviewed
- createdAt

Important:
- Do not show full transcript by default.
- Brief should be short and practical.

### CustomerIntakeToken

Public token for customer detail intake.

Fields:
- id
- businessId
- customerId
- tokenHash
- status
- expiresAt
- openedAt
- submittedAt
- revokedAt
- createdAt

Rules:
- raw token is never stored
- public API does not expose internal IDs unnecessarily

### Task

Represents follow-up work.

Fields:
- id
- businessId
- customerId
- offerId
- communicationId
- title
- type
- status
- priority
- dueDate
- dueTime
- note
- createdFromAi
- aiDraft
- completedAt
- createdAt
- updatedAt

Types:
- call_back
- send_offer
- follow_up_offer
- ask_for_photos_documents
- book_appointment
- visit_customer
- wait_for_reply
- reject_client
- other

### Appointment

Appointments may be represented as task types in current backend pilot. A separate normalized table may come later.

Fields when normalized:
- id
- businessId
- customerId
- taskId
- offerId
- title
- appointmentType
- status
- startsAt
- endsAt
- location
- notes
- calendarProvider
- calendarEventId
- createdAt
- updatedAt

Status:
- proposed
- accepted
- declined
- time_change_requested
- cancelled
- completed

### Offer

Represents a commercial offer.

Fields:
- id
- businessId
- customerId
- relatedTaskId
- relatedCallId
- offerNumber
- status
- offerDate
- validUntil
- subtotal
- vatRate
- vatAmount
- total
- notes
- terms
- acceptanceText
- createdFromAi
- createdAt
- updatedAt

Status:
- draft
- ready_to_send
- sent_manually
- sent_provider
- accepted
- rejected
- expired
- cancelled

### OfferItem

Fields:
- id
- businessId
- offerId
- description
- quantity
- unitPrice
- lineTotal
- sortOrder

### OfferResponseToken

Public token for offer accept/reject.

Fields:
- id
- businessId
- offerId
- customerId
- tokenHash
- status
- expiresAt
- openedAt
- respondedAt
- response
- comment
- revokedAt
- createdAt

### AppointmentResponseToken

Public token for appointment response.

Fields:
- id
- businessId
- taskId
- appointmentId
- customerId
- offerId
- tokenHash
- status
- expiresAt
- openedAt
- respondedAt
- response
- requestedDate
- requestedTime
- comment
- revokedAt
- createdAt

### MessageTemplate

Reusable business/sector message.

Fields:
- id
- businessId
- sectorProfileId
- key
- channel
- title
- subject
- body
- variables
- active
- createdAt
- updatedAt

Template examples:
- new_customer_intake
- missed_call
- out_of_hours
- offer_sent
- appointment_proposal
- reject_client
- lead_acknowledgement

### ProviderConnection

Represents connected communication or calendar providers.

Fields:
- id
- businessId
- provider
- providerType
- status
- displayName
- senderId
- scopes
- metadata
- createdAt
- updatedAt

Provider types:
- phone
- email
- viber
- whatsapp
- calendar
- leads

Important:
- never expose credentials in frontend
- store secrets only in secure backend/env/provider vault

### AutomationRule

Represents user-enabled automation.

Fields:
- id
- businessId
- name
- trigger
- conditions
- actions
- status
- reviewRequired
- createdByAi
- createdAt
- updatedAt

Examples:
- new lead -> create call task
- out-of-hours call -> send intake message
- reject client approved -> send polite message
- customer reply with time -> create appointment task

### CalendarEvent

Represents calendar sync state.

Fields:
- id
- businessId
- appointmentId
- provider
- externalEventId
- status
- startsAt
- endsAt
- syncError
- createdAt
- updatedAt

Providers:
- google_calendar
- apple_calendar
- ics_feed
- internal

### LeadSource

Represents lead integrations.

Fields:
- id
- businessId
- provider
- sourceName
- status
- defaultOwnerId
- defaultTaskType
- autoReplyTemplateId
- createdAt
- updatedAt

Providers:
- wordpress_form
- generic_webhook
- meta
- google
- tiktok
- manual_import

### FileAttachment

Represents files related to customers.

Fields:
- id
- businessId
- customerId
- communicationId
- offerId
- taskId
- filename
- mimeType
- sizeBytes
- storagePath
- uploadedBy
- createdAt

### TimelineEvent

Represents unified customer history.

Fields:
- id
- businessId
- customerId
- type
- title
- body
- relatedEntityType
- relatedEntityId
- actorType
- actorId
- occurredAt
- metadata

Types:
- call
- call_brief
- note
- task_created
- task_completed
- appointment_created
- appointment_response
- offer_created
- offer_response
- message_sent
- message_drafted
- intake_submitted
- file_uploaded
- customer_rejected
- status_changed

## AI result model

AI output should be structured and review-first.

Fields:
- intent
- customerMatch
- proposedCustomerUpdate
- proposedBrief
- proposedTasks
- proposedAppointment
- proposedOffer
- proposedMessage
- proposedStatus
- warnings
- confidence
- requiresReview

No AI action should silently modify final customer data unless an explicit automation rule allows it.

## Privacy boundaries

Raw audio:
- temporary or restricted storage only
- do not expose in normal UI unless explicitly required

Transcript:
- processing artifact
- not shown by default
- not stored as normal CRM history unless explicitly approved

Brief:
- primary CRM artifact
- short, practical, reviewed

Messages:
- draft or sent provider result must be tracked

Tokens:
- raw public token is shown only in generated link
- store only hash
