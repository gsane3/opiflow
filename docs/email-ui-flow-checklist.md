# Email UI flow checklist

## Scope

Manual UI checks for the offer email sending surface. This covers the flow from the offer preview page through `SendEmailSection` to the `POST /api/email/send-offer` backend route.

This is a manual walkthrough checklist, not an automated test suite.

The email route sends real email only when `RESEND_API_KEY` and `EMAIL_FROM` are configured. If those are missing, the route returns `missing_email_config` and no email is sent.

---

## Safe preview mode

Use this mode when you want to confirm the UI flow without sending real email.

**Setup:** Do not set `RESEND_API_KEY` or `EMAIL_FROM` in `.env.local`. Restart the dev server if they were previously set.

Steps:

1. Open the app locally.
2. Navigate to any offer preview page.
3. Scroll to the "Αποστολή email" section.

- [ ] The email form renders with recipient, subject, and message fields.
- [ ] The pre-send safety note is visible: "Αν η αποστολή email είναι ρυθμισμένη στον server, το κουμπί θα στείλει πραγματικό email στη διεύθυνση παραλήπτη."
- [ ] The PDF disclaimer is visible.
- [ ] Fill in any valid-format email address and click "Αποστολή email".
- [ ] The UI shows the amber message: "Δεν έχει ρυθμιστεί αποστολή email στον server, οπότε δεν στάλθηκε email. Μπορείς να αντιγράψεις το draft και να το στείλεις χειροκίνητα."
- [ ] The message clearly says no email was sent.
- [ ] The "Πίσω" button returns to the form.
- [ ] No success message is shown.

---

## Controlled real email mode

Use this mode only when intentionally testing real sends. Read all safety notes before proceeding.

**Safety notes before proceeding:**
- Use a test recipient address you own. Do not use real customer email addresses.
- Do not paste real customer personal data into the subject or message fields.
- There is no auth backend. Any visitor who can reach the UI can trigger a real send if Resend is configured.
- The in-memory rate limiter allows 5 requests per IP per 60 seconds and is per serverless instance only.
- `.env.local` must not be committed. Confirm with `git status --short`.

**Setup:** Set `RESEND_API_KEY` and `EMAIL_FROM` in `.env.local`. Restart the dev server.

Steps:

1. Open the app locally.
2. Navigate to an offer preview page for a test offer.
3. Scroll to the "Αποστολή email" section.

- [ ] Replace the recipient address with a test address you own.
- [ ] Review the pre-filled subject and message. Remove any real customer data if present.
- [ ] Confirm the pre-send safety note is visible.
- [ ] Click "Αποστολή email".
- [ ] The button shows "Αποστολή..." while the request is in progress.
- [ ] After a successful send, the UI shows: "Το email στάλθηκε επιτυχώς."
- [ ] Verify the test email arrived at your test inbox.
- [ ] The success message is only shown after a real successful send. It must not appear when config is missing.
- [ ] The optional "Σήμανση ως Στάλθηκε" button is visible but not automatically triggered.
- [ ] The optional follow-up task button is visible but not automatically triggered.
- [ ] Clicking "Αποστολή νέου" returns to the form without sending again.

---

## UI copy checks

Confirm the following text is present and accurate at the time of testing:

- [ ] Section heading: "Αποστολή email".
- [ ] Pre-send safety note mentions that real email will be sent if the server is configured.
- [ ] PDF disclaimer mentions this is MVP and PDF is not attached automatically.
- [ ] Missing config message states no email was sent and that the user can send manually.
- [ ] Success message says the email was sent successfully.
- [ ] No text claims SMS was sent.
- [ ] No text claims a VoIP call was made.
- [ ] No text claims call recording was performed.
- [ ] No text claims automatic or scheduled sending was done.

---

## After testing

- Confirm no real customer email addresses were used.
- Confirm no real customer personal data was in the subject or message during testing.
- Confirm `.env.local` is not staged (`git status --short` must not list it).
- If you set Resend vars only for this test, consider whether to keep them set or remove them to return to safe preview mode.
- Restore any env vars you temporarily removed and restart the dev server before resuming normal use.
