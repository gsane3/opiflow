# Backend smoke test checklist

## Scope

Manual smoke tests for the two existing server-side API routes:

- `POST /api/ai/review`
- `POST /api/email/send-offer`

These are local, one-off checks — not a substitute for an automated test suite.

---

## Before testing

- App must be running locally (`npm run dev`, default port 3000).
- Provider keys must be set in `.env.local` (server-only — never in `NEXT_PUBLIC_` vars).
- **Do not commit `.env.local`.**
- **Do not paste real customer names, emails, or personal data into test requests.**
- The email route will send a real email if `RESEND_API_KEY` and `EMAIL_FROM` are configured. Use a controlled test recipient address you own.

---

## Route: POST /api/ai/review

Base URL: `http://localhost:3000/api/ai/review`

### 1. Valid request

```
curl -s -X POST http://localhost:3000/api/ai/review \
  -H "Content-Type: application/json" \
  -d '{"inputText":"Test invoice: 1x service 100 EUR"}'
```

Expected: `200 OK`, body contains `{ "result": { ... } }`.

- [ ] Response is 200
- [ ] `result` object is present and non-empty

---

### 2. Missing or wrong Content-Type

```
curl -s -X POST http://localhost:3000/api/ai/review \
  -H "Content-Type: text/plain" \
  -d 'hello'
```

Expected: `415 Unsupported Media Type`, `{ "error": "unsupported_content_type" }`.

- [ ] Status is 415
- [ ] Error code is `unsupported_content_type`

---

### 3. Payload too large (Content-Length header exceeds 32 000 bytes)

Send a request with `Content-Length` header set above 32 000.

Expected: `413 Content Too Large`, `{ "error": "payload_too_large" }`.

- [ ] Status is 413
- [ ] Error code is `payload_too_large`

---

### 4. Empty or too-long `inputText`

**Empty:**

```
curl -s -X POST http://localhost:3000/api/ai/review \
  -H "Content-Type: application/json" \
  -d '{"inputText":""}'
```

**Too long (over 2000 characters):** send a string longer than 2000 chars.

Expected: `400 Bad Request`, `{ "error": "invalid_input" }`.

- [ ] Status is 400
- [ ] Error code is `invalid_input`

---

### 5. Missing `ANTHROPIC_API_KEY`

Remove or unset `ANTHROPIC_API_KEY` in `.env.local`, restart the dev server, then send a valid request.

Expected: `503 Service Unavailable`, `{ "error": "no_api_key" }`.

- [ ] Status is 503
- [ ] Error code is `no_api_key`
- [ ] Restore the key and restart before continuing.

---

### 6. Rate limit

Send more than 10 requests to this route within 60 seconds from the same IP.

Expected on the 11th request: `429 Too Many Requests`, `{ "error": "rate_limited" }`.

- [ ] Status is 429
- [ ] Error code is `rate_limited`

Note: the in-memory store resets on server restart; restart the dev server to reset the counter.

---

### 7. Provider timeout

Hard to trigger manually. The route aborts the Anthropic call after 20 seconds and returns:

Expected: `504 Gateway Timeout`, `{ "error": "ai_timeout" }`.

- [ ] (Optional) Confirm the constant `AI_PROVIDER_TIMEOUT_MS = 20_000` is set in the route source if verifying by code inspection.

---

## Route: POST /api/email/send-offer

Base URL: `http://localhost:3000/api/email/send-offer`

**Safety reminder:** if `RESEND_API_KEY` and `EMAIL_FROM` are configured, a real email will be sent. Use a test address you own.

### 1. Valid request

```
curl -s -X POST http://localhost:3000/api/email/send-offer \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","subject":"Test offer","text":"This is a test."}'
```

Expected: `200 OK`, `{ "ok": true, "id": "<resend-id>" }`.

- [ ] Response is 200
- [ ] `ok` is `true`

---

### 2. Missing or wrong Content-Type

```
curl -s -X POST http://localhost:3000/api/email/send-offer \
  -H "Content-Type: text/plain" \
  -d 'hello'
```

Expected: `415 Unsupported Media Type`, `{ "ok": false, "error": "unsupported_content_type" }`.

- [ ] Status is 415
- [ ] Error code is `unsupported_content_type`

---

### 3. Payload too large (Content-Length header exceeds 32 000 bytes)

Send a request with `Content-Length` header set above 32 000.

Expected: `413 Content Too Large`, `{ "ok": false, "error": "payload_too_large" }`.

- [ ] Status is 413
- [ ] Error code is `payload_too_large`

---

### 4. Missing `RESEND_API_KEY` or `EMAIL_FROM`

Remove or unset one of these in `.env.local`, restart the dev server, then send a valid request.

Expected: `503 Service Unavailable`, `{ "ok": false, "error": "missing_email_config" }`.

- [ ] Status is 503
- [ ] Error code is `missing_email_config`
- [ ] Restore the vars and restart before continuing.

---

### 5. Invalid recipient email

```
curl -s -X POST http://localhost:3000/api/email/send-offer \
  -H "Content-Type: application/json" \
  -d '{"to":"not-an-email","subject":"Test","text":"Body."}'
```

Expected: `400 Bad Request`, `{ "ok": false, "error": "invalid_email" }`.

- [ ] Status is 400
- [ ] Error code is `invalid_email`

---

### 6. Missing body content (no `text` or `html`)

```
curl -s -X POST http://localhost:3000/api/email/send-offer \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","subject":"Test"}'
```

Expected: `400 Bad Request`, `{ "ok": false, "error": "missing_body" }`.

- [ ] Status is 400
- [ ] Error code is `missing_body`

---

### 7. Rate limit

Send more than 5 requests to this route within 60 seconds from the same IP.

Expected on the 6th request: `429 Too Many Requests`, `{ "ok": false, "error": "rate_limited" }`.

- [ ] Status is 429
- [ ] Error code is `rate_limited`

Note: the in-memory store resets on server restart.

---

### 8. Provider timeout

Hard to trigger manually. The route aborts the Resend call after 15 seconds and returns:

Expected: `504 Gateway Timeout`, `{ "ok": false, "error": "email_timeout" }`.

- [ ] (Optional) Confirm the constant `EMAIL_PROVIDER_TIMEOUT_MS = 15_000` is set in the route source if verifying by code inspection.

---

## After testing

- Confirm no real customer data was used in any request.
- Confirm `.env.local` is not staged (`git status --short` should not show it).
- Restore any env vars that were temporarily removed during testing and restart the dev server.
