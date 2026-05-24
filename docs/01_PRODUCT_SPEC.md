# yorgos.ai Product Spec

Last refreshed: 2026-05-24
Current scope: backend-backed AI phone assistant pilot.

## Product summary

yorgos.ai helps Greek professionals who handle many phone calls turn conversations into customer history, tasks, appointments, offers and follow-up messages.

The product should prove one main idea:

A professional can run their phone-driven business through an AI assistant that listens, summarizes, organizes and prepares actions for review.

## Product pillars

### 1. Assistant-first, not CRM-first

The user should think:

> What needs to happen next?

Not:

> I need to update my CRM.

CRM exists under the hood. The user experience should feel like a business assistant.

### 2. Phone-first

Calls are the strongest product wedge.

The product should treat every call as a business event:
- who called
- when they called
- what they asked
- what must happen next
- whether they need an offer
- whether they need an appointment
- whether they need follow-up

### 3. Mobile-first

The first real use case is a professional on the road.

The app must work well on a phone:
- fast
- simple
- thumb-friendly
- readable
- minimal admin
- clear next action

### 4. Sector-aware

The user chooses a sector during setup.

The sector controls:
- terminology
- default task types
- offer style
- customer fields
- automation suggestions
- message templates
- AI tone

First sector:
- technical services and call-heavy professionals.

Later sectors:
- accountants
- real estate agents
- spare parts businesses
- doctors
- takeaway
- construction
- other local service businesses

### 5. Review-first AI

AI can suggest. The user approves.

Default:
- no automatic CRM save without review
- no automatic provider send without review
- no automatic appointment confirmation without review

Later:
- explicit automation rules may allow auto-send for selected workflows.

### 6. Consent-first call recording

Call recording is core, but must not be hidden.

The product must support clear notice or consent depending on legal and provider setup.

No legal compliance claim should be made before legal review.

## V1 live pilot scope

### Core live features

- Register and business setup
- Sector selection
- Business profile
- Managed business phone number flow
- Incoming call log
- Date and time per call
- Customer matching by phone
- New customer creation from call
- AI call brief
- Customer workspace
- Tasks
- Appointments
- Offers
- Offer response links
- Appointment response links
- AI Assistant commands
- Viber intake for new customer details
- Email/Viber message drafts or provider-gated sends
- Review-first action flow
- Backend-backed data

### Current backend-backed surfaces

- Dashboard
- Customers
- Customer detail
- Calls
- Tasks
- Appointments
- Offers
- Offer preview
- Settings
- Public offer response
- Public appointment response
- Intake token flow

### Planned live features

- Fully backend-backed Customer Workspace with editable sections
- Fully backend-backed AI Assistant
- Reject client action
- Email provider integration
- Viber provider hardening
- Google Calendar integration
- Apple Calendar integration or calendar export/feed
- Lead automation through generic webhooks
- WordPress forms lead intake
- Meta, Google and TikTok leads later
- Provider connection settings
- Automation rule builder

## Core workflows

### New incoming caller

1. Caller calls the business number.
2. yorgos.ai receives the call event.
3. Call is logged with date, time and phone number.
4. If the customer is unknown, a customer record is created or suggested.
5. AI creates a short brief after the call.
6. Viber or message intake link is sent or drafted to collect details.
7. Customer submits details.
8. Customer workspace updates.

### Existing client call

1. Existing customer calls.
2. Call is matched to customer.
3. AI creates a short call brief.
4. AI suggests tasks, appointments, offer or follow-up.
5. User reviews.
6. Approved items are saved to the customer workspace.

### AI Assistant command

Examples:
- “Στείλε προσφορά στον Παπαδόπουλο για 450 ευρώ.”
- “Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10.”
- “Απέρριψε τον πελάτη ευγενικά.”
- “Θύμισέ μου να καλέσω τη Μαρία την Παρασκευή.”
- “Ποιοι πελάτες περιμένουν απάντηση;”

Flow:
1. User speaks or types.
2. AI Assistant parses intent.
3. App shows review screen.
4. User edits and approves.
5. Backend action is saved or message is sent if provider is enabled and approved.

### Offer flow

1. Offer is created from AI Assistant, call review or customer workspace.
2. User reviews offer.
3. Offer response link is generated.
4. Customer can accept or reject.
5. Response is recorded.
6. Timeline and offer status update.

### Appointment flow

1. Appointment is created from AI Assistant, call review or customer workspace.
2. User reviews details.
3. Appointment response link is generated.
4. Customer can accept, reject or request time change.
5. Time change can include plus or minus suggestion.
6. Internal appointment remains source of truth.
7. Calendar sync is planned.

### Reject client flow

1. User clicks `Reject client`.
2. App shows a polite message draft.
3. User reviews.
4. If email/Viber provider is enabled, send after confirmation.
5. If not, create a copyable draft.
6. Customer timeline records the action.

### Out-of-hours flow

1. Call comes outside business hours.
2. Customer receives an automatic or reviewed message.
3. Message asks for details and preferred contact time.
4. A task is created for follow-up.

## V1, soon, later

### V1

- Managed number first
- Backend customer workspace
- Call log and AI brief
- AI Assistant review-first actions
- Offers and appointments with response links
- Viber intake for new customers
- Reject client draft/send flow
- Provider-gated email/Viber sends
- Generic webhook lead intake

### Soon

- Google Calendar
- Apple Calendar support through appropriate integration or calendar export
- Meta leads
- Google leads
- WordPress plugin or webhook presets
- WhatsApp exploration
- Better automation rule builder
- Basic analytics

### Later

- Number portability
- Existing number forwarding support after testing
- Sector-specific advanced modules
- Billing
- Teams and roles
- Native iOS and Android apps
- Advanced call analytics
- Live call coaching
- More provider integrations

## Explicit non-goals for current pilot

- No hidden recording
- No fake provider sends
- No fake legal compliance claims
- No automatic AI save without review
- No automatic send unless provider is implemented and explicitly approved
- No unsupported claim that forwarded calls preserve caller ID
- No visible demo/local product experience
