# Supabase for Noodle

Sign-in (email code) and the `ai` Edge Function. The Groq key lives here, never in the app.

```
supabase/
  config.toml                 CLI + auth config (6-digit codes, email templates, function settings)
  templates/code.html         the email: shows {{ .Token }} (the code) instead of a link
  migrations/                 ai_usage table + take_ai_call() (the daily cap)
  functions/ai/               the Edge Function (JavaScript)
    config.js                 model IDs, Groq URL, timezone, default cap  <- change models here
    core.js                   limits + validators, shared with the app
    groq.js, handler.js       Groq calls and request handling
    index.js                  wires in Supabase auth and the counter
    handler.test.js           tests with fakes (npm run test:function)
  tests/database/             pgTAP test for the cap (supabase test db)
```

Run the CLI as `npx supabase ...` (or `brew install supabase/tap/supabase`, then drop `npx`).

## One-time setup (you do these)

1. **Create a project** at https://supabase.com/dashboard (New project). Save the database password. Note the *project ref* (the `abcd1234` in `https://abcd1234.supabase.co`).

2. **Log in and link** (a browser tab opens for the login; `link` asks for the database password):

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Create the usage table and counter** (CLI v3 defaults `db` commands to the local Docker stack, so `--remote` is needed):

   ```bash
   npx supabase db push --remote
   ```

4. **Set up custom SMTP first.** A free project on Supabase's built-in mailer cannot change email templates (`config push` fails with "Email template modification is not available for free tier projects using the default email provider"). Dashboard > Authentication > Emails > SMTP Settings: turn on custom SMTP and enter a provider's details (Resend, Brevo, or Gmail with an app password). Do not put the SMTP password in `config.toml`.

   **Make the email send a code, not a link.** Dashboard > Authentication > Emails (Email Templates). Edit both **Magic link** (returning users) and **Confirm signup** (first sign-in): set the subject to `Your Noodle code` and the body to the contents of `supabase/templates/code.html`. The part that matters is `{{ .Token }}`; a template with only `{{ .ConfirmationURL }}` sends a link.

   Or push the same settings from `config.toml` (it shows a diff and asks first; read it, as it also pushes the other `[auth]` values):

   ```bash
   npx supabase config push
   ```

   Then Authentication > Sign In / Providers > Email: keep **Confirm email** off, and leave **Email OTP Length** at 6.

5. **Set the Groq key** (typed in your own terminal; nothing is echoed or saved in history):

   ```bash
   read -rs "KEY?Groq key: "; echo; npx supabase secrets set GROQ_API_KEY="$KEY"; unset KEY
   ```

   Optional, to change the 500 calls/day per user: `npx supabase secrets set AI_DAILY_CAP=300`.

6. **Deploy the function** (add `--use-api` if Docker is not running):

   ```bash
   npx supabase functions deploy ai
   ```

7. **Tell the app where the project is.** Dashboard > Project Settings > API Keys: copy the Project URL and the **Publishable** key (`sb_publishable_...`, never the secret key).

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in the two values, then restart Metro so it reads them:

   ```bash
   npx expo start --dev-client -c
   ```

8. **Check the function is up** (no token, so expect `401`; with `ok` in the browser the key is wrong):

   ```bash
   curl -i https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai -H "apikey: YOUR_PUBLISHABLE_KEY"
   ```

Then in the app: Settings > Sign in > your email > the 6-digit code. Thoughts waiting for the AI are processed right away.

**Email limits.** Supabase's built-in mailer is for testing: it only mails your project team's addresses and allows very few emails an hour. For the owner's own address that is fine; before inviting anyone, add custom SMTP (Authentication > Emails > SMTP Settings).

**EAS cloud builds** do not see `.env.local`. Give them the same two values once per environment, e.g.:

```bash
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value "https://YOUR_PROJECT_REF.supabase.co" --visibility plaintext
```

```bash
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "sb_publishable_..." --visibility plaintext
```

The existing development build needs no rebuild for this change: no native module was added. Only a new EAS build needs the variables above.

## Tests

```bash
npm run test:function
```

Input validation, the daily cap, auth and "never echo the key or Groq errors", with fakes (Node 22, no Docker).

```bash
npx supabase start
npx supabase test db
```

The real counter (`take_ai_call`: cap, refused calls not counted, per-user, app cannot call it) against a local Postgres. Needs Docker.

## Run the function locally

```bash
echo "GROQ_API_KEY=your-key" > supabase/functions/.env   # gitignored
npx supabase start
npx supabase functions serve ai --env-file supabase/functions/.env
```

Point `EXPO_PUBLIC_SUPABASE_URL` at the local URL `npx supabase status` prints.

## Notes

- Every call needs a signed-in user's JWT (`verify_jwt = true`, checked again in code). A call counts toward the cap before Groq is contacted; a call refused by the cap or by validation costs nothing.
- Errors to the app are `{ error: { code, message } }` with short fixed messages. Groq's own errors and the key stay in the function logs only (`npx supabase functions logs ai` or Dashboard > Edge Functions > Logs, which hold status codes, not bodies).
- `GET` on the function returns the model names and cap without spending a call; Settings uses it.
