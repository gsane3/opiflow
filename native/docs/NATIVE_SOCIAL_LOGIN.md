# Native social login (Google + Apple) — setup runbook

The app code is done (PR adds «Συνέχεια με Google» / «Συνέχεια με Apple» on the
login screen, using Supabase OAuth + an in-app browser, PKCE). It will **not work
until the steps below are done** — these are server/console-side and need **no app
rebuild** once the build that contains the buttons is installed.

- Supabase project: `oluhmztfimmgmbxoioea`
- Supabase callback (used by Google/Apple): `https://oluhmztfimmgmbxoioea.supabase.co/auth/v1/callback`
- App redirect (used by Supabase → back into the app): `opiflow://auth/callback`

---

## 0) Supabase — allow the app redirect (once)
Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs** → add:
```
opiflow://auth/callback
```
(Keep the existing web URLs too.)

## 1) Google
1. **Google Cloud Console** → APIs & Services → **OAuth consent screen**: configure (External, app name «Opiflow», support email, your domain). Publish it.
2. APIs & Services → **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized redirect URI:** `https://oluhmztfimmgmbxoioea.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret**.
3. **Supabase** → Authentication → **Providers → Google** → enable → paste the **Client ID** + **Client secret** → Save.

## 2) Apple  (required by App Store if Google is offered)
1. **Apple Developer** → Certificates, IDs & Profiles → **Identifiers → +** → **Services IDs** → create e.g. `ai.opiflow.signin` (description «Opiflow Sign In»).
   - Enable **Sign in with Apple** → Configure:
     - **Primary App ID:** `ai.opiflow.app`
     - **Domains:** `oluhmztfimmgmbxoioea.supabase.co`
     - **Return URLs:** `https://oluhmztfimmgmbxoioea.supabase.co/auth/v1/callback`
2. **Keys → +** → enable **Sign in with Apple** → register → download the **`.p8`** key. Note the **Key ID** and your **Team ID** (`7Q7A3NFK8T`).
3. **Supabase** → Authentication → **Providers → Apple** → enable → fill:
   - **Client IDs (Services ID):** `ai.opiflow.signin`
   - **Team ID:** `7Q7A3NFK8T`
   - **Key ID:** (from step 2)
   - **Secret key (.p8 contents):** paste the whole `.p8`
   - Save.

## 3) Test
Install the build that has the buttons → login screen → **Συνέχεια με Google / Apple**.
An in-app browser opens, you authorize, and the app signs you in (no rebuild needed
between provider tweaks).

### Notes
- The **Apple** button shows on **iOS only** (native requirement); Google shows everywhere.
- New social users land in Supabase Auth; the app's onboarding/`/api/businesses/me`
  flow applies to them like any other account.
- If a button errors with "provider is not enabled", the Supabase provider toggle
  (step 1/2) isn't on yet.
