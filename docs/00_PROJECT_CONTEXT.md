# yorgos.ai Project Context

## Product name

yorgos.ai

## One-line summary

yorgos.ai is a mobile-first AI assistant for professionals in Greece who work on the road and need every customer conversation turned into CRM notes, follow-up tasks, offer drafts and communication drafts.

## What the product is

yorgos.ai is not a traditional CRM. It is a practical AI work assistant for small professionals and teams who lose time after calls because they have to remember customer needs, write notes, create follow-ups and prepare offers manually.

The long-term product direction is a consent-based business call recording and AI workflow platform.

The MVP should show the core magic loop:

1. A customer call, missed call, lead or voice command happens.
2. The app extracts what matters.
3. The user reviews the result.
4. The app saves a CRM update, tasks, offer draft and communication drafts.
5. The user sends or acts manually.

## Who it is for

The product is for Greek freelancers, service businesses and small professional teams that handle many customer calls while moving between jobs, appointments or sites.

The MVP should be generic, but guided by profession during onboarding.

The user chooses a business type at the start. The AI tone, task suggestions, summaries and offer drafts should adapt to that profession.

Initial business modes:

- Technical services, for example HVAC, plumber, electrician, installer, mechanic
- Sales and services, for example insurance broker, consultant, real estate agent
- Projects and construction, for example renovation contractor, contractor, custom work
- Other

## Core problem

Small professionals often do not use CRM properly because they are busy, mobile and call-driven. They forget details, lose follow-ups, delay offers and miss opportunities.

Common problems:

- Customer requests stay in memory, call logs, notebooks or chat apps.
- Follow-ups are forgotten.
- Offers are delayed.
- Missed calls are not handled fast.
- Leads from marketing channels wait too long before being contacted.
- Customer history is scattered.
- The professional wants help, but does not want heavy CRM admin.

## Core value proposition

The product promise:

Μίλα. Το app οργανώνει τα υπόλοιπα.

Practical value:

- Fewer lost leads
- Faster follow-ups
- Faster offer drafts
- Cleaner customer history
- Less manual CRM work
- Better daily focus for professionals on the road

## Core selling point

The strongest long-term selling point is consent-based call recording and automatic extraction.

Production vision:

A professional uses a yorgos.ai VoIP number or connected VoIP line. Calls are recorded only after clear notice or consent. The app then creates CRM summaries, tasks, offer drafts and next best actions.

MVP reality:

The call recording flow is mocked. The app should clearly show demo/mock labels so it does not pretend to have real VoIP recording yet.

## MVP direction

The MVP is a working prototype with real AI processing and local CRM data, but without real VoIP, real auth, database or production integrations.

MVP includes:

- Greek-only UI
- Mock login and registration
- Onboarding with profession selection
- Business settings
- Logo preview for offers
- CRM list
- Customer profile
- Source and opportunity value
- Tasks and follow-ups
- Offers page
- Dashboard focused on what needs attention today
- Mock call flow with call recording indicator
- Demo call transcripts
- Real speech-to-text for user dictation where supported
- Text fallback for dictation
- Real AI API processing through a minimal backend/API proxy
- Review screen before saving AI output
- PDF-style offer preview
- Copy Viber and email drafts
- Google Maps link from customer address
- Local storage persistence
- Mock workspace/team indicator
- Mock CRM import from XLS/CSV placeholder

## Legal and privacy direction

Important product rules:

- Do not design hidden call recording.
- Do not claim legal compliance without legal review.
- Raw audio should not be stored permanently.
- Full transcripts should not be stored by default.
- The MVP stores only final structured results and summary after user review.
- Every AI-generated CRM update, task, offer or message must be reviewed by the user before saving.
- The user must be able to delete customer notes, tasks, offers and customer records.
- Future real call recording must use clear notice or consent.
- Future production launch needs proper legal review for GDPR, telecommunications and call recording rules in Greece and the EU.

Suggested wording:

Designed with privacy-first and consent-first architecture. Final legal compliance must be reviewed before production launch.

## Important product separations

The app must clearly separate:

- Raw audio, future only, temporary and not permanently stored
- Transcript, future processing artifact, not stored by default
- CRM summary, saved after review
- Follow-up task, saved after review
- Offer draft, saved after review
- Sent offer status, manually marked in MVP

## What must be preserved

These decisions are important and should not be changed without approval:

- Greek-only MVP UI
- Mobile-first responsive web app / PWA
- Desktop/browser compatible
- No native apps in MVP
- No real VoIP in MVP
- No real call recording in MVP
- Mock call recording flow is allowed and important
- Real AI processing is required
- Real speech-to-text is desired, with text fallback
- Local storage first
- Mock auth only
- No database unless explicitly approved
- No automatic sending of offers
- User review before save
- Viber and email drafts are copied manually
- PDF-style preview only in MVP
- Business type selected during onboarding controls tone and task logic

## Backend v2 note

The localStorage and mock-auth constraints in this document apply to the MVP.

Backend v2 is explicitly approved and documented in `BACKEND_SPEC.md` at the project root.

This context document remains the product direction and MVP product rules reference. For backend implementation decisions, use `BACKEND_SPEC.md`.
