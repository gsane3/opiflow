# yorgos.ai User Flows

Last refreshed: 2026-05-24
Current scope: backend-backed AI phone assistant pilot.

## 1. First entry flow

User opens app
→ registers
→ chooses sector
→ enters business details
→ configures working hours and communication preferences
→ chooses or connects business number
→ lands on dashboard

First live sector:
- technical services and call-heavy professionals

Later sectors:
- accountants
- real estate
- spare parts
- doctors
- takeaway
- other services

## 2. Sector setup flow

User chooses sector
→ app stores business context
→ AI adapts tone, tasks, offer defaults and message templates
→ customer workspace fields and automations adapt to the sector

Examples:
- technician: appointment, site visit, photos, parts, offer
- real estate: property, viewing, buyer/seller, follow-up
- accountant: document request, deadline, tax period
- spare parts: part code, availability, quote, pickup/shipping

## 3. Managed number flow

User chooses a new yorgos.ai business number
→ number is connected to the phone/PBX/provider flow
→ incoming calls are logged
→ call brief and customer actions are created after calls

Existing number forwarding:
- may be supported later
- requires provider test
- original caller ID is not guaranteed until tested
- legal and recording behavior must be confirmed

Number portability:
- later option
- requires provider/legal validation

## 4. Dashboard daily flow

User opens app
→ sees urgent calls and follow-ups
→ sees tasks for today
→ sees pending appointments
→ sees open offers
→ uses AI Assistant or quick actions

Dashboard should answer:
- who needs a call
- which customer needs action
- which offer waits
- which appointment needs response
- what AI suggests next

## 5. Incoming new caller flow

Unknown phone calls business number
→ call event is created
→ call is recorded only if consent/legal flow is valid
→ AI creates brief after call
→ system creates or suggests new customer
→ Viber or message intake link is sent or drafted
→ customer fills details
→ customer workspace updates
→ AI suggests next task or appointment

## 6. Incoming existing client flow

Known customer calls
→ call is matched to customer
→ call event appears in customer timeline
→ AI creates short call brief
→ AI suggests tasks, appointment, offer or message
→ user reviews
→ approved actions are saved

## 7. Missed call flow

Missed call appears
→ customer is matched if possible
→ if unknown, a lead is created or suggested
→ call back task is created
→ optional out-of-hours or missed-call message is sent or drafted
→ timeline records action

## 8. Out-of-hours flow

Call comes outside working hours
→ caller receives message if provider/automation is enabled
→ message asks for details and preferred contact time
→ task is created for follow-up
→ if provider is unavailable, app shows draft/fallback

Example message:
`Οι γραμμές είναι κλειστές αυτή τη στιγμή. Συμπληρώστε τα στοιχεία σας και θα επικοινωνήσουμε μαζί σας το συντομότερο.`

## 9. Customer workspace flow

User opens customer
→ sees contact details, source, value, status and preferred channel
→ sees latest call brief
→ sees timeline
→ edits customer fields directly
→ creates tasks, appointments, offers and messages
→ reviews files and notes
→ can reject client if needed

## 10. AI Assistant command flow

User opens AI Assistant
→ speaks or types command
→ AI parses intent
→ app shows review screen
→ user edits
→ user approves
→ backend action is created or message is sent/drafted

Example commands:
- `Κλείσε ραντεβού με τον Παπαδόπουλο αύριο στις 10.`
- `Φτιάξε προσφορά 450 ευρώ στον Καραγιάννη.`
- `Στείλε μήνυμα ότι θα καλέσω αύριο.`
- `Απέρριψε ευγενικά τον πελάτη.`
- `Δείξε μου ποιοι περιμένουν προσφορά.`
- `Βάλε follow-up την Παρασκευή.`

## 11. AI review after call flow

AI result appears
→ user reviews customer match
→ user reviews call brief
→ user reviews needs
→ user reviews proposed tasks
→ user reviews proposed appointment
→ user reviews proposed offer
→ user reviews proposed message
→ user saves or sends

Nothing final happens before review by default.

## 12. Offer flow

User creates offer from:
- customer workspace
- AI Assistant
- call review
- task

Offer is saved as draft
→ user reviews line items, VAT, notes and terms
→ offer response link is generated
→ customer accepts or rejects
→ offer status updates
→ timeline records response
→ follow-up task can be created

## 13. Appointment flow

User creates appointment from:
- customer workspace
- AI Assistant
- call review
- offer acceptance

Appointment is saved
→ response link is generated
→ customer accepts, rejects or requests time change
→ requested time change can include plus or minus suggestion
→ user reviews change
→ internal appointment updates
→ calendar sync happens when integration exists

## 14. Calendar flow

Internal appointment remains source of truth.

When Google Calendar or Apple Calendar integration is enabled:
→ approved appointment is created or synced
→ calendar event is linked back to internal appointment
→ changes are logged
→ failures show clear retry/fallback message

## 15. Reject client flow

User opens customer
→ clicks `Απόρριψη πελάτη`
→ app generates polite message
→ user reviews and edits
→ if provider enabled, sends after confirmation
→ if provider unavailable, creates copyable draft
→ customer status changes if approved
→ timeline records reject action

## 16. Viber message flow

Message can be created from:
- new customer intake
- offer
- appointment
- reject client
- missed call
- out-of-hours
- AI Assistant

If provider enabled:
→ show review
→ user confirms
→ send
→ log result

If provider unavailable:
→ create copyable draft
→ log draft if saved

## 17. Email flow

Email can be created from:
- offer
- appointment
- reject client
- follow-up
- lead response

If email provider enabled:
→ show review
→ user confirms
→ send
→ log result

If provider unavailable:
→ create email draft/copy text

## 18. Lead automation flow

New lead arrives from:
- WordPress form
- generic webhook
- Meta lead
- Google lead
- TikTok lead
- manual import

System creates lead
→ creates call requirement task
→ sends or drafts acknowledgement message
→ AI Assistant can summarize pending leads
→ user calls or schedules follow-up

## 19. Customer response link flow

Public customer-facing links include:
- intake link
- offer response link
- appointment response link

Rules:
- raw token is never stored
- response is recorded in backend
- no internal IDs are exposed
- no automatic legal/signature claim
- no provider message send unless implemented

## 20. Automation rule flow

Later phase:

User creates rule with AI Assistant or settings
→ app shows trigger, condition and action
→ user enables rule
→ future matching events trigger actions
→ every auto-send has audit trail and provider status

Example:
- When new Facebook lead arrives, send email asking preferred call time.
- When customer replies with time, create calendar task.
- When reject client is approved, send polite Viber message.
