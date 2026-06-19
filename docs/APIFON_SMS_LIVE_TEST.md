# Apifon SMS / Viber — live test & troubleshooting (owner)

**Why this exists:** the SMS/Viber send code (`src/lib/server/apifon-sms.ts`,
`apifon-viber.ts`) was reviewed and is **correct** — it mirrors the working Viber
path exactly (same OAuth flow, correct per-channel scope, correct endpoint + body
shape). When SMS "doesn't arrive" it is almost always an **Apifon account / sender
configuration** issue, not a code bug. This guide makes a live test conclusive.

Only the owner can run this: the assistant cannot handle the secret credentials.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `APIFON_CLIENT_ID` | ✅ | Apifon API client id |
| `APIFON_API_KEY` | ✅ | Apifon API secret (used as the OAuth `client_secret`) |
| `APIFON_SMS_SENDER` | ✅ for SMS | Approved SMS sender id (alphanumeric or number). Falls back to `APIFON_SENDER_ID`. |
| `APIFON_VIBER_SENDER_ID` | ✅ for Viber | Approved Viber sender id. Falls back to `APIFON_SENDER_ID`. |
| `APIFON_SENDER_ID` | optional | Shared fallback for both senders. |
| `APIFON_BASE_URL` | optional | Defaults to `https://ars.apifon.com`. |
| `APIFON_WEBHOOK_SECRET` | optional | Adds `?secret=…` to the delivery-status callback URL. |

After changing any var, **redeploy** (Vercel does not hot-reload env into running functions).

## 2. Run the test

1. In the app, open a customer with a real Greek mobile and send any message
   (project chat «Μήνυμα στον πελάτη», or «Ζήτα στοιχεία»).
2. Watch **Vercel → Deployments → (current) → Functions → Logs** while you send.

## 3. Read the result

The send helpers now log the **exact Apifon rejection reason** on failure
(privacy-safe — only Apifon's own response, never the recipient number or the
message text):

```
[apifon-sms]   send failed status=<http> error=<code> body=<apifon-json>
[apifon-viber] send failed status=<http> error=<code> body=<apifon-json>
```

Common causes:

| What you see | Meaning | Fix |
|---|---|---|
| `error=apifon_oauth_failed` / OAuth 401 | client id/secret wrong, or scope `smsGateway`/`imGateway` not granted | check `APIFON_CLIENT_ID` / `APIFON_API_KEY`; ask Apifon to enable the SMS gateway scope |
| `status=400` body mentions sender | sender id not approved for SMS | get the sender approved by Apifon, set `APIFON_SMS_SENDER` to it |
| body mentions credit/balance | account out of SMS credit | top up |
| `missing_apifon_config` (in the API response, no log line) | env vars not set / not redeployed | set the vars above and redeploy |
| nothing logged, message "sent" but not received | Apifon accepted it — delivery issue downstream | check the Apifon dashboard delivery report + the `/api/webhooks/apifon/status` callback |

## 4. Notes

- The customer's `preferred_contact_method` decides the channel: `sms` → SMS
  directly; anything else → Viber with **automatic SMS fallback**. So a customer
  set to Viber will still get SMS if Viber fails — both paths now log failures.
- Phone normalisation is already correct for `+30…`, `0030…`, bare `69…`/`210…`
  (`normalizeApifonMsisdn`). A `missing_or_invalid_phone` skip means the stored
  number genuinely isn't a valid MSISDN.
