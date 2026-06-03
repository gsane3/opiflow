# deskop.ai UI Guide

Last refreshed: 2026-05-24
Current direction: mobile-first AI phone assistant with backend-backed customer workspace.

## UI language

Greek-first for the Greek market.

Use simple professional Greek.

Avoid heavy SaaS terminology when there is a clearer Greek alternative.

Good labels:
- Αρχική
- Κλήσεις
- Πελάτες
- AI Assistant
- Tasks
- Ραντεβού
- Προσφορές
- Πελάτης
- Timeline
- Αρχεία
- Νέα ενέργεια
- Επόμενη ενέργεια
- Περίληψη κλήσης
- Απόρριψη πελάτη

## UI personality

The app should feel:

- fast
- practical
- clean
- trustworthy
- assistant-like
- built for professionals who work through calls

It should not feel like:

- heavy enterprise CRM
- complicated call center software
- overdesigned AI toy
- legal/compliance product
- old demo prototype

## Main UX principle

The app should answer:

> What needs my attention now?

Not:

> Where do I update a database record?

## Mobile-first rules

- Important actions must be reachable with one thumb.
- Use bottom navigation.
- Keep cards readable.
- Avoid dense tables on mobile.
- Use short summaries first, details second.
- Use review screens before saving or sending AI actions.
- Put the next safest action close to the user.
- Make call and customer context visible quickly.

## Desktop rules

Desktop can show more context, but should not become heavy CRM.

Preferred desktop layout:
- left navigation
- main work area
- optional right-side context panel
- cards and sections instead of dense admin tables

## Main navigation

Suggested live pilot navigation:

1. Αρχική
2. Κλήσεις
3. Πελάτες
4. AI Assistant
5. Tasks
6. Ραντεβού
7. Προσφορές
8. Ρυθμίσεις

Mobile can use fewer visible tabs and move secondary pages into a menu if needed.

## AI Assistant

AI Assistant is a first-class feature.

Entry points:
- main nav or prominent action
- microphone
- type fallback
- customer workspace
- call review
- task and offer flows

The assistant should support commands such as:
- create task
- create appointment
- create offer
- send message
- reject client
- search customer
- summarize today
- show pending offers
- show leads needing call

All write/send actions should go through review by default.

## Customer workspace

Customer detail is the central workspace.

It should include:

- customer header
- status and source
- contact details
- preferred communication method
- opportunity value
- next best action
- call briefs
- timeline
- tasks
- appointments
- offers
- notes
- files
- messages
- quick actions
- edit controls inside each section

Sections should be editable without forcing the user to leave the customer page.

Important actions:
- Call
- Create task
- Create appointment
- Create offer
- Send message
- Reject client
- Open in Maps
- Copy Viber draft
- Copy email draft
- Upload or attach file, when implemented

## Calls UI

Calls page should show real backend call surfaces only.

Each call card should show:
- date and time
- caller
- matched customer if any
- direction
- status
- AI brief if available
- next action
- link to customer

Do not show visible demo call entry points in production surfaces.

## AI review UI

Any AI-created action should show:

- what AI understood
- confidence or warnings if needed
- customer match
- editable fields
- proposed tasks
- proposed appointment
- proposed offer
- proposed message
- save or send action

Use clear wording:
- `Έλεγξε πριν αποθηκευτεί`
- `Έλεγξε πριν σταλεί`
- `Δεν στάλθηκε ακόμα`

## Offers UI

Offer preview should feel like a clean business document.

Include:
- business details
- customer details
- offer number
- date
- valid until
- line items
- VAT
- total
- notes
- terms
- response link status

Do not show fake PDF/download/provider claims if not implemented.

## Appointments UI

Appointment cards should show:
- customer
- date
- time
- type
- status
- response link status
- requested time change if any

Calendar sync should be shown only when implemented.

## Files section

Files belong inside the customer workspace.

V1 can start as metadata and placeholder if storage is not ready. Do not fake upload success.

Later file types:
- photos
- documents
- estimates
- signed forms
- call-related files
- offer PDFs

## Timeline

Timeline should be the customer history.

It can include:
- calls
- AI briefs
- notes
- tasks
- appointments
- offers
- messages
- customer intake submissions
- files
- status changes
- reject client events

Timeline should be filterable later, but first version can be a clear chronological list.

## Reject client UX

Reject client should not be hidden under destructive actions.

Flow:
1. User clicks `Απόρριψη πελάτη`.
2. App shows polite message draft.
3. User reviews and edits.
4. If provider is enabled, user confirms send.
5. If provider is unavailable, app creates copyable draft.
6. Timeline records the result.

## Empty states

Empty states should be helpful, not decorative.

Examples:
- `Δεν υπάρχουν κλήσεις ακόμα. Όταν συνδεθεί αριθμός, οι κλήσεις θα εμφανίζονται εδώ.`
- `Δεν υπάρχουν ανοιχτά tasks για σήμερα.`
- `Δεν υπάρχουν προσφορές για αυτόν τον πελάτη.`
- `Δεν υπάρχουν αρχεία ακόμα.`

## Visual style

Preferred:
- calm neutral background
- clear cards
- rounded sections
- strong spacing
- one clear primary action color
- minimal visual noise
- readable Greek text
- mobile-friendly buttons

## What should not appear in live UI

- visible demo call paths
- localStorage/MVP copy
- fake provider sending claims
- fake legal compliance claims
- hidden recording wording
- automatic send copy unless provider is connected and confirmed
