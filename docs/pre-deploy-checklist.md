# Pre-deploy go/no-go checklist

**Decision: first preview deploy uses safe preview mode. Resend variables are not set.**

This is a manual go/no-go checklist for the first Vercel preview deploy. Complete all sections before deploying. This is not an automated test suite.

---

## Go condition

All items in every section below must be checked. If any item cannot be checked, do not deploy until it is resolved.

---

## Local validation

Run these locally before pushing to Vercel.

- [ ] `npm run lint` passes with no errors.
- [ ] `npm run build` passes with no errors.
- [ ] `git status --short` does not list `.env.local`. If it does, stop and remove it from staging before proceeding.

---

## Environment variables

Configure in Vercel Project Settings > Environment Variables.

**Add for first preview:**

- [ ] `ANTHROPIC_API_KEY` is set in Vercel (server-only, not `NEXT_PUBLIC_`).

**Do not add for first preview (safe mode decision):**

- [ ] `RESEND_API_KEY` is NOT set in Vercel. First deploy uses safe preview mode.
- [ ] `EMAIL_FROM` is NOT set in Vercel.
- [ ] `EMAIL_REPLY_TO` is NOT set in Vercel (not needed while email sending is disabled).

**Hygiene:**

- [ ] No provider key uses a `NEXT_PUBLIC_` prefix.
- [ ] No provider key appears in client-side source code. All `process.env` reads are inside `src/app/api/` route files only.

---

## Vercel function duration

The app's provider timeouts are: AI route 20 seconds, email route 15 seconds. Vercel's actual function execution limit depends on the project plan and the current Function Max Duration setting.

- [ ] Check the Function Max Duration value in Vercel Project Settings for the target environment.
- [ ] Confirm it is at least 20 seconds, OR lower the app timeouts in the route files, OR set `export const maxDuration = <seconds>` on the route handlers (subject to plan caps). Document the chosen mitigation.

If the Vercel limit is lower than the app timeout and no mitigation is applied, the function may be killed by Vercel and the caller will see a generic Vercel error instead of the app's `ai_timeout` or `email_timeout` response.

---

## Backend route checks

Test locally against `http://localhost:3000` before deploying.

**AI review route:**

- [ ] Sending a valid JSON request to `POST /api/ai/review` returns a result or a clear error. If `ANTHROPIC_API_KEY` is missing locally, it returns `503 no_api_key` rather than crashing.
- [ ] Sending a request with wrong content-type returns `415 unsupported_content_type`.
- [ ] Sending more than 10 requests within 60 seconds from the same IP returns `429 rate_limited` on the eleventh request.

**Email send route:**

- [ ] Sending a valid JSON request to `POST /api/email/send-offer` without Resend vars configured returns `503 missing_email_config`. No email is sent.
- [ ] Sending a request with wrong content-type returns `415 unsupported_content_type`.
- [ ] Sending a request with `Content-Length` above 32 000 bytes returns `413 payload_too_large`.
- [ ] Sending more than 5 requests within 60 seconds from the same IP returns `429 rate_limited` on the sixth request.

See `docs/backend-smoke-test-checklist.md` for the full curl-based test procedures.

---

## Email UI safe mode checks

Complete these with Resend env vars absent (safe preview mode).

- [ ] Navigate to an offer preview page. The page loads without errors.
- [ ] The "Αποστολή email" section appears below the offer document.
- [ ] The recipient, subject, and message fields are visible and pre-filled.
- [ ] The pre-send safety note is visible: "Αν η αποστολή email είναι ρυθμισμένη στον server, το κουμπί θα στείλει πραγματικό email στη διεύθυνση παραλήπτη."
- [ ] The PDF disclaimer is visible below the message field.
- [ ] Clicking "Αποστολή email" shows the amber message: "Δεν έχει ρυθμιστεί αποστολή email στον server, οπότε δεν στάλθηκε email. Μπορείς να αντιγράψεις το draft και να το στείλεις χειροκίνητα."
- [ ] The message clearly states no email was sent.
- [ ] No success message ("Το email στάλθηκε επιτυχώς.") is shown.
- [ ] The user can navigate back to the form using "Πίσω".

See `docs/email-ui-flow-checklist.md` for the full UI flow procedures.

---

## Product honesty checks

Confirm by clicking through the app that:

- [ ] No screen claims real SMS was sent or will be sent.
- [ ] No screen claims real VoIP calls are made or recorded.
- [ ] No screen claims real call recording is available.
- [ ] No screen claims email is sent automatically or on a schedule.
- [ ] Any demo or simulated flow is clearly labeled as demo or MVP-only.

---

## Do not deploy if

Stop and resolve before deploying if any of the following is true:

- [ ] `.env.local` is staged in git.
- [ ] Any provider API key appears in client-side code or in a `NEXT_PUBLIC_` variable.
- [ ] `RESEND_API_KEY` or `EMAIL_FROM` are set in Vercel without a documented decision to enable real email sends and an understanding of the public-send risk.
- [ ] `npm run build` fails.
- [ ] `npm run lint` reports errors.
- [ ] The UI shows a success email message when no Resend vars are configured.
- [ ] Any UI screen claims real SMS, VoIP, or call recording is operational.

---

## After first deploy

- Share the preview URL only with known reviewers until auth is added.
- Do not use real customer personal data during review sessions.
- To enable real email sending later: add `RESEND_API_KEY` and `EMAIL_FROM` to Vercel, then complete the real email mode section of `docs/email-ui-flow-checklist.md` before sharing the URL further.
