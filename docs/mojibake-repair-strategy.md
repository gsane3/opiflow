# Mojibake repair strategy

## Affected file

`src/app/(app)/demo/production-readiness/page.tsx`

The damage appears isolated to this one file. All other source files and docs checked during inspection are clean.

---

## What is broken

The file contains extensive corrupted Greek strings. Markers present include: `Î`, `Ï`, `Ã`, `Â`, `â€`. Examples:

- `PRIORITY_LABEL` values: `'Î¥ÏˆÎ·Î»Î®'` instead of `'Υψηλή'`
- `PILOT_ITEMS` labels and notes: all Greek strings corrupted
- All Greek section headings, bullet arrays, and metric labels
- English strings with em dash: `'Demo only â€" no real calls'` instead of the intended dash

The TypeScript and React structure of the file appears structurally valid. Imports, types, identifiers, hooks, handlers, JSX brackets, and Tailwind classes are all intact. Only the string literal content is corrupted. The file likely compiles, but renders garbled text to users in the browser.

---

## Likely cause

UTF-8 Greek text was misread as Windows-1252 by an editor or tool, then saved again as UTF-8. This double-encodes each multibyte character: Greek `Υ` (bytes `0xCE 0xA5`) becomes `Î¥` when each byte is misinterpreted as a Windows-1252 character. The em dash `—` (bytes `0xE2 0x80 0x94`) becomes `â€"` by the same mechanism. The rest of the codebase escaped because only this file was processed by the offending tool.

---

## Forbidden repair approaches

- No bulk encoding conversion utilities (iconv, recode, Python codecs, .NET Encoding classes).
- No PowerShell `Get-Content` or `Set-Content` with `-Encoding` flags.
- No shell or Node.js scripts that rewrite the file's bytes.
- No one-by-one random edits across dozens of individual corrupted strings. With over 70 corrupted strings the drift and verification risk is too high.

---

## Preferred repair order

### Step 1: Check git history

Run:

```
git log --oneline -- src/app/(app)/demo/production-readiness/page.tsx
```

Identify the last commit before corruption was introduced. Inspect it:

```
git show <clean-commit-hash>:src/app/(app)/demo/production-readiness/page.tsx | head -60
```

Confirm the content is free of `Î`, `Ï`, `â€` markers.

### Step 2a: If a clean revision exists

Restore the file from that revision:

```
git checkout <clean-commit-hash> -- src/app/(app)/demo/production-readiness/page.tsx
```

Then apply the small targeted updates listed in the "Stale claims" section below as separate, focused edits.

### Step 2b: If no clean revision exists

Perform one controlled full-content replacement in a single execution using known product truth. The replacement must:

- Preserve the route path `/demo/production-readiness`.
- Preserve all imports, types, hooks, state, and handler logic exactly.
- Rewrite all corrupted string literals as correct UTF-8 Greek.
- Apply the stale claim corrections at the same time.

Do not split this into partial attempts.

---

## Product truth to preserve

These facts must remain accurate after repair. Do not let any section contradict them.

- No real VoIP in MVP.
- No real call recording in MVP.
- No real SMS sending in MVP.
- Real email sending exists only when `RESEND_API_KEY` and `EMAIL_FROM` are configured on the server. Without those, the route returns `missing_email_config` and no email is sent.
- The first preview deploy uses safe preview mode: Resend env vars are not set.
- localStorage remains the MVP data store.
- No auth backend yet.
- No database yet.
- AI review results must be reviewed and confirmed by the user before saving to the CRM.

---

## Stale claims to update during repair

Update these at the same time as the encoding fix. Do not leave them for a later step.

1. **Email delivery row** (`GAP_TABLE`): currently says "Copy-to-clipboard draft only." Update to: the route can send real email when `RESEND_API_KEY` and `EMAIL_FROM` are set; safe preview mode omits those vars and no email is sent.

2. **"What is real in MVP" section**: currently lists only Viber/email copy drafts for communications. Add a separate bullet noting that optional real email delivery via Resend exists when the provider env vars are configured, and that the first preview deploy intentionally omits them.

3. **MVP 2 Priorities, email item**: currently framed as future work to remove copy-paste friction. Update to: the backend route exists; remaining work is auth, quota safety, and the decision of when to enable real email mode in a deployed instance.

4. **AI API key row** (`GAP_TABLE`): if the current text says "falls back to demo," verify against the live route. The actual route returns HTTP 503 `no_api_key` when the key is missing. Update the row to reflect that behavior if needed.

5. **Smoke tests section**: add a check row for `POST /api/email/send-offer` in safe preview mode (expects `503 missing_email_config`, no email sent, UI shows "not configured" message).

---

## Validation after repair

Run these after the file is restored or rewritten:

```
git diff --check
npm run lint
npm run build
```

Then in the browser:

- Open `/demo/production-readiness`.
- Confirm all section headings and body text render correctly in Greek.
- Confirm no `Î`, `Ï`, `â€` markers appear in the rendered page.
- Confirm the priority labels ("Υψηλή", "Μεσαία", "Χαμηλή") render correctly in the gap table.
- Confirm the pilot checklist labels render correctly.
- Confirm the updated email claim reads accurately.
