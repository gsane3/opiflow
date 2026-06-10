# Twilio Support Ticket — inbound `<Dial><Client>` returns 404 although the device registered

**Submit at:** https://help.twilio.com → Create a case (or Console → Help → Support).
**Product:** Programmable Voice / Voice SDK · **Region:** US1

---

## Subject
Voice SDK: `register()` succeeds (Registered, no error) but inbound `<Dial><Client>` returns **404 Not Found** with **no push attempted** and **no Debugger errors**.

## Account / resources
- **Account SID:** `AC……` *(fill in your full Account SID)*
- **Region:** US1 (all resources)
- **TwiML App (outgoing, WORKS):** `AP9488c713f9251425ef80636986c25eb0` (“opiflow-voice”)
- **SIP Domain (inbound):** `opiflow.sip.twilio.com` → Voice Request URL `https://www.opiflow.ai/api/webhooks/voice/twilio/inbound` (POST)
- **Push Credential (iOS APNs):** `CRb9a1fda8ccaa5e7413a8e29ed4426ce0` — type `apn`, `sandbox=false` (production), “Opiflow iOS VoIP”
- **Client identity:** `biz_44892a77cce34a268e3d13c99071b413`
- **SDK:** `@twilio/voice-react-native-sdk` 2.0.0-preview.2 (iOS), underlying `TwilioVoice` 6.13.6

## What works
- **Outbound** in-app calls work perfectly (the device connects as `client:biz_44892a77cce34a268e3d13c99071b413`, visible in the call logs).
- The iOS app calls `voice.register(accessToken)` → the **`Registered` event fires with no error** → `voice.getDeviceToken()` returns a **real 64-hex APNs VoIP token**.

## The problem (inbound)
A Greek DID (on an external carrier) reaches our Asterisk PBX, which dials the Twilio SIP Domain as `sip:biz_44892a77cce34a268e3d13c99071b413@opiflow.sip.us1.twilio.com`. The SIP Domain fires our Voice webhook, which returns:
```xml
<Response><Dial answerOnBridge="true"><Client>biz_44892a77cce34a268e3d13c99071b413</Client></Dial></Response>
```
Twilio responds on the SIP leg:
```
SIP/2.0 100 trying
SIP/2.0 180 Ringing
SIP/2.0 404 Not found
```
The registered device is **never woken** (CallKit never rings).

## What we have already verified (please don't re-suggest these — all confirmed correct)
1. Access token (twilio-node `AccessToken` + `VoiceGrant`): `identity=biz_44892a77cce34a268e3d13c99071b413`, `incomingAllow=true`, `pushCredentialSid=CRb9a1fda8ccaa5e7413a8e29ed4426ce0`, `region/twr=us1`, valid (outbound uses the same token and works).
2. Push Credential `CRb9…` is `apn` + `sandbox=false`; the uploaded VoIP cert + private key are a valid matching pair (modulus match), topic `ai.opiflow.app.voip` = app bundle `ai.opiflow.app` + `.voip`.
3. The iOS build is **ad-hoc / internal distribution = production APNs** (`aps-environment=production`), matching the production push credential.
4. The device obtains a real **PushKit VoIP** device token (64 hex), used in the registration.
5. Identity string matches exactly between the token, the registration, and the `<Client>` TwiML (all-lowercase hex).
6. Account is **upgraded (paid)**, not trial.
7. **Monitor → Logs → Errors (Debugger) is EMPTY** — no 52xxx push errors, nothing — i.e. Twilio appears to make **no push attempt** at all for the inbound `<Client>` leg.

## Questions for Twilio
1. For identity `biz_44892a77cce34a268e3d13c99071b413` in our account — **is there an active Voice SDK push registration / binding?** (We see `register()` succeed but cannot list registrations via the API.)
2. If the registration exists, **why does inbound `<Dial><Client>` return 404 and attempt no push** (no Debugger error)?
3. If it does NOT exist, **why did `registerWithAccessToken` return success** to the SDK?
4. Is there any account-level setting required for SIP-Domain → `<Dial><Client>` to reach a registered mobile Voice SDK client?

## Example failing calls (US1, today)
- ~16:10:53 UTC — real inbound call → SIP Domain → 100/180/404
- ~16:27:21 UTC — test call → same 100/180/404

Thank you — we believe the registration is being accepted but not made discoverable to `<Dial><Client>`, and need server-side visibility into why.

---

## FOLLOW-UP REPLY (send after their first generic response)

Thank you, but we have **already verified every item** in your list and the issue persists:

- **Region:** us1 for the SIP Domain, TwiML App, and Push Credential, AND the access token now carries `twr=us1`. No change.
- **Identity:** exact-match confirmed — the SAME string `biz_44892a77cce34a268e3d13c99071b413` is used by our working **outbound** calls (visible in the call logs as `client:biz_44892a77cce34a268e3d13c99071b413`), our registration, and the `<Client>` TwiML. No hidden chars/case issues.
- **Push credential:** `CRb9a1fda8ccaa5e7413a8e29ed4426ce0`, `apn`, `sandbox=false`; cert+key are a valid matching pair; topic `ai.opiflow.app.voip` matches the bundle. It is the SAME SID embedded in the access token's VoiceGrant.
- **Device token:** fresh 64-hex PushKit VoIP token; we re-register on every app launch; tested with a 30s+ propagation wait.
- **Environment:** the build is ad-hoc / internal distribution (`aps-environment=production`), matching the production credential.
- **Account:** upgraded (paid), not trial.

The decisive symptom: **Monitor → Logs → Errors (Debugger) is completely EMPTY** — Twilio attempts **no push at all** for the inbound `<Client>` leg (not even a 52134 to a stale token). This means **no binding is found**, which per your own reply is the "register succeeds on the client but the binding is not properly created/visible" edge case.

**We need this escalated to the Programmable Voice / Voice SDK engineering team:**
1. Please have an engineer check **internally** whether ANY active push binding exists for identity `biz_44892a77cce34a268e3d13c99071b413` in account `AC……`. (We understand there is no public API — we are asking your team to look.)
2. If `registerWithAccessToken` returns **success** to the SDK but **no binding is created** server-side, that is a platform/SDK defect — please confirm and advise.
3. We are using **`@twilio/voice-react-native-sdk` `2.0.0-preview.2`** (a *preview* release) on iOS, with the underlying `TwilioVoice` 6.13.6. **Is there a known issue with push registration in this preview version?** Should we move to the latest **stable 1.x** for reliable incoming, and if so what is the recommended Expo/React Native integration?

We have a fully working outbound path on the same account/token, so the credentials and account are sound — the gap is specifically the inbound push-binding discoverability.
