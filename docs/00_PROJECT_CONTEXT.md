# deskop.ai Project Context

Last refreshed: 2026-05-24
Current phase: backend-backed pilot, moving toward live AI phone assistant.

## Product name

deskop.ai

## One-line summary

deskop.ai is an AI phone assistant and CRM automation platform for Greek professionals who handle many calls and need every conversation turned into useful business action.

## What the product is

deskop.ai is not a traditional CRM.

It is a practical AI phone assistant for professionals and small businesses that receive many calls, lose follow-ups, delay offers and spend too much time organizing customer work manually.

The product combines:

- managed business phone number
- call logging
- consent-first call recording where legally and technically enabled
- AI call brief
- customer workspace
- tasks
- appointments
- offers
- customer response links
- Viber, email and later WhatsApp automations
- AI Assistant commands
- lead automation

The product should feel like:

> Μίλα. Το app οργανώνει τα υπόλοιπα.

## Core product direction

The long-term product is a sector-aware AI phone assistant.

A professional should be able to:

1. Register.
2. Choose sector.
3. Add business details.
4. Choose or connect a business number.
5. Receive calls through deskop.ai.
6. See every call as date, time, caller and short AI brief.
7. Review AI-suggested tasks, appointments, offers and messages.
8. Use the AI Assistant to create actions by speaking or typing.
9. Send offer and appointment links to customers.
10. Automate follow-ups through approved provider connections.

## First target sector

The first live sector is technical services and call-heavy Greek professionals, for example:

- electricians
- technicians
- installers
- aluminium professionals
- plumbers
- HVAC professionals
- repair businesses
- small service teams

These users have high call volume, missed calls, appointments, offers and urgent follow-ups.

## Later sectors

Later sector profiles may include:

- accountants
- real estate agents
- spare parts businesses
- doctors
- takeaway and food businesses
- construction and renovation teams
- consultants and service firms

Each sector can have different default flows, templates, fields, task types and automations.

## Core problem

Greek professionals often run their business through phone calls, Viber messages, notebooks and memory.

Common problems:
- missed calls are forgotten
- call details are not recorded
- offers are delayed
- customers do not send their details clearly
- appointments are not confirmed cleanly
- follow-ups are lost
- leads from ads wait too long
- customer history is scattered
- professionals do not want heavy CRM admin

## Core value proposition

deskop.ai turns calls and messages into organized business work.

Practical value:
- fewer lost leads
- faster follow-ups
- faster offer drafts
- cleaner customer history
- clearer daily priorities
- less manual CRM work
- better response speed
- more professional communication

## Calls are the core selling point

The strongest product wedge is the phone flow.

A call should create:

- call date and time
- caller phone number
- matched or new customer
- AI call brief
- suggested tasks
- suggested appointment
- suggested offer if relevant
- suggested message if relevant
- timeline event inside the customer workspace

## Phone number strategy

V1 preferred strategy:

- managed deskop.ai business number through a SIP/provider setup
- new number provisioned or assigned to the business
- call flow controlled by deskop.ai/PBX/provider integration

Existing number forwarding may be supported later, but only after real provider testing confirms:

- original caller ID behavior
- legal and consent flow
- recording feasibility
- reliability
- support model

Do not assume caller ID passthrough works for forwarded calls until tested with the real provider and route.

Number portability may be explored later.

## Backend pilot reality

The project has moved beyond the first local/mock MVP.

Current direction:
- backend-backed CRM surfaces
- Supabase-backed data
- public token response flows for offers and appointments
- PBX and provider foundations
- production-facing surfaces should not show demo/local MVP copy

Hidden demo/local code may still exist, but direction is full removal.

## AI principles

AI should assist, not silently act.

Default behavior:
- AI listens or processes input
- AI proposes structured output
- user reviews
- user edits
- user approves
- only then data is saved or sent

Auto-send is allowed only later when:
- provider connection is implemented
- user has explicitly enabled the automation rule
- audit trail is written
- product copy is honest

## Legal and privacy direction

Important product rules:

- no hidden call recording
- no legal compliance claims without legal review
- call recording needs clear notice or consent depending on final legal advice
- raw audio should not be stored longer than needed
- full transcripts should not be shown or stored by default unless approved
- call brief is preferred over transcript
- every AI-generated CRM update, task, offer or message must be review-first by default
- users must understand when a provider message will actually be sent
- no fake provider claims

Suggested wording:

Designed with privacy-first and consent-first architecture. Final legal compliance must be reviewed before production launch.

## Important separations

The product must clearly separate:

- phone provider event
- raw audio
- transcription or processing artifact
- AI call brief
- CRM timeline event
- user-reviewed tasks
- user-reviewed offers
- user-reviewed messages
- automatic provider sends enabled by explicit rules

## What must be preserved

- Greek-first product.
- Mobile-first responsive app.
- Assistant-first, not CRM-first.
- Calls are core.
- Review before save and send.
- No hidden recording.
- No fake provider claims.
- Customer workspace is central.
- AI Assistant is a first-class live feature.
