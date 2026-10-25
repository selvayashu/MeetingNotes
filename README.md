# MeetNotes

AI meeting notes as an installable PWA. Record (or upload) a meeting in **English, Hindi or Tamil**
(including mixed speech) and get a timestamped transcript, a summary, decisions and action items.

- **Frontend:** React + Vite + TypeScript + Tailwind, `vite-plugin-pwa`, IndexedDB offline queue
- **API:** Cloudflare Pages Functions (`/functions/api`), secrets and AI calls stay server-side
- **AI:** Cloudflare Workers AI — Whisper large-v3-turbo (speech-to-text) and Llama 3.3 70B (notes)
- **Backend:** Supabase Auth, Postgres with Row Level Security, private Storage bucket

```
Browser ──(anon key + user JWT, RLS)──────────────▶ Supabase (Auth · Postgres · Storage)
   │
   └──POST /api/process-meeting (user JWT)──▶ Pages Function ──(service role)──▶ Supabase
                                                    └──(env.AI)──▶ Workers AI (Whisper, Llama)
```

How processing works (details and measurements in [`docs/workers-ai-notes.md`](docs/workers-ai-notes.md)):

1. Recordings are cut into ~5 minute self-contained segments in the browser (uploaded WAV files are sliced
   client-side), because the server has no ffmpeg to cut webm/mp4.
2. `/api/process-meeting` transcribes parts for up to ~35 s per call, saves progress, and the app calls it
   again until done. Retrying resumes from the first unfinished part.
3. It then summarises the transcript chunk by chunk (map) and merges the results (reduce), validating the
   model's JSON with Zod and retrying once on bad output or the wrong language.

---

## 1. Local setup

Requirements: Node 20+, a Supabase project (or Docker for the local stack), a Cloudflare account.

```bash
git clone https://github.com/selvayashu/MeetingNotes.git
cd MeetingNotes
git checkout pwa-rewrite          # the PWA lives on this branch; main holds an older project
npm install
```

Create the config files (every variable is documented in [`.env.example`](.env.example)):

```bash
cp .env.example .env.local        # keep only the VITE_* lines you need
cp .dev.vars.example .dev.vars    # SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the Functions
```

Set up Supabase (section 2), then run two processes:

```bash
npm run build && npx wrangler pages dev dist --port 8788   # Functions + Workers AI
npm run dev                                                # Vite on :5173, proxies /api to :8788
```

Open <http://localhost:5173>. Re-run `npm run build` when you want `wrangler` to serve a fresh frontend; Function
changes reload on their own.

> **Workers AI is remote even in local dev.** `wrangler pages dev` calls the real service with the Cloudflare
> account you are logged into (`npx wrangler login`), so local testing uses your real allowance.

Useful scripts: `npm test` (unit + component tests), `npm run typecheck` (Functions), `npm run build`.

## 2. Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. Link it and apply the migrations (this also creates the private `recordings` bucket and all RLS policies):
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   Prefer the local stack? Install Docker, then `npx supabase start` and `npx supabase db reset`.
3. **Auth settings** are declared in `supabase/config.toml` and applied with `npx supabase config push`: e-mail +
   password sign-in, **e-mail confirmation off** (no code is e-mailed at sign-up; the admin approves instead),
   passwords of at least 8 characters with letters and digits, the Site URL and the Redirect URLs. Run
   `npx supabase config diff` first: it must show only what you intend, because the file also declares defaults that
   may differ from your project. Change the URLs in the file to your own domain.
4. **Auth → URL Configuration** (what the file sets): Site URL = your deployed URL; Redirect URLs =
   `http://localhost:5173`, `http://localhost:8788`, the Pages URL and `<Pages URL>/**`.
5. **Project Settings → API:** copy the URL and `anon` key into `.env.local`, and the URL and
   `service_role` key into `.dev.vars`. The service role key bypasses RLS: never put it in `.env.local`,
   a `VITE_*` variable, or the repo.
6. Check **Storage**: a private bucket named `recordings` should exist.

Migrations (`supabase/migrations/`): schema → RLS → storage policies → audio parts and processing state → admin approval.
Users can only change their own meetings' title, date and languages; processing columns are service-role only.

## 3. Deploy to Cloudflare Pages

1. Push the repo to GitHub, then **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**
   and pick `selvayashu/MeetingNotes` and the `pwa-rewrite` branch (or merge it to your production branch).
2. Build settings:
   - Framework preset: Vite (or None)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Variables** (Settings → Variables and Secrets):
   - Build/plain: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAX_RECORDING_MINUTES`
   - Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
     (or `npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name <name>`)
4. The Workers AI binding (`AI`) and the limits (`MAX_MEETINGS_PER_DAY`, `MAX_RECORDING_MINUTES`) come from
   [`wrangler.toml`](wrangler.toml). Per Cloudflare's docs, once a Pages project has a Wrangler file the file is
   the source of truth for those fields and they can't be edited in the dashboard. Edit the file and redeploy.
5. Add the Pages URL to Supabase's Redirect URLs (section 2, step 4).

> Cloudflare now says Workers supports most Pages use cases and recommends Workers for new projects. This repo
> targets Pages as requested; the Functions code would move to a Worker with little change.

### Plan and cost notes
- Whisper costs about **$0.0005 per audio minute**; notes cost roughly 30 neurons per chunk.
  The Workers AI free allowance is 10,000 neurons/day shared across both.
- The Workers free plan has tight CPU (10 ms) and subrequest (50) limits per request. Base64-encoding
  audio and a multi-part call can exceed them. **If you see CPU or subrequest errors in production, the
  Workers Paid plan ($5/month) is the fix.** This has not been verified on a deployed project yet.

## Accounts, sign-in and password reset

- **Sign up** needs only a **name, e-mail and password** (the e-mail is the username). No e-mail is sent and no code
  is needed, because e-mail confirmation is switched off. The account is created as *pending*.
- **Sign in** is e-mail + password. A new or rejected user is let in but sees only the waiting/refused screen.
- **Forgot password:** the sign-in page's *Forgot password?* sends a reset link by e-mail; opening it shows
  *Choose a new password*. The answer is identical whether or not the account exists. Signed-in users can also change
  their password under **Settings**. Links are single-use and expire.
- **Password rule:** at least 8 characters including a letter and a digit, enforced by Supabase (`config.toml`) and
  mirrored in the forms (`src/lib/password.ts`).
- **Trade-off, deliberately chosen:** because the e-mail is not verified at sign-up, anyone can register *with any
  address*. The admin approval step is what stops that from mattering. Check that the address and name are who you
  expect before approving.
- The only e-mail the app sends is the password-reset link. Supabase's built-in sender is limited to a few e-mails an
  hour, so configure your own SMTP (Auth → SMTP Settings) before relying on resets.
- The first admin has no password if they signed up before password sign-in existed: use *Forgot password?*, or in the
  Supabase dashboard (Authentication → Users) send a recovery e-mail or set one.

## Admin approval

New sign-ups can log in but land on a **"Waiting for approval"** screen and can use nothing until an admin approves
them. Approval is enforced in the database (restrictive RLS on every table and on the `recordings` bucket) and again
in `/api/process-meeting`, so hiding a button is not the only protection.

- **First admin:** emails in the `admin_emails` table become approved admins automatically when they sign up. Add
  yours before signing in for the first time (accounts that already exist when the migration runs are approved):
  ```sql
  insert into public.admin_emails values ('you@example.com');
  -- or, if you already have an account:
  update public.profiles set is_admin = true, status = 'approved'
   where id = (select id from auth.users where email = 'you@example.com');
  ```
  Run it with `npx supabase db query --linked "<sql>"` or in the dashboard's SQL editor.
- **Approving users:** admins get an **Admin** link in the header. It lists users as *Waiting for approval*,
  *Approved* and *Rejected*, with Approve / Reject / Revoke access buttons. Admin accounts can't be changed from the
  page, and an admin can't change their own status.
- **Making someone else an admin:** `update public.profiles set is_admin = true where id = '<user id>'` (deliberately
  not available in the UI).
- Rejecting or revoking takes effect immediately for data access. The user's open tab will notice the next time it
  loads their profile.
- There is **no e-mail notification** when someone signs up; check the Admin page.

## 4. Configuration reference

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build / `.env.local` | Browser Supabase client |
| `VITE_MAX_RECORDING_MINUTES` | build / `.env.local` | Client recording cap (default 90) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | secrets / `.dev.vars` | Server access to Supabase |
| `MAX_MEETINGS_PER_DAY` | `wrangler.toml` `[vars]` | Per-user daily rate limit (default 10) |
| `MAX_RECORDING_MINUTES` | `wrangler.toml` `[vars]` | Server length cap (default 90) |
| `LLM_MODEL` | `[vars]` / `.dev.vars` | Override the notes model |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | CI only | Deploying outside the Git integration |

Per-user setting: **Settings → Delete audio after notes are generated** removes the recordings once notes exist.
The interface language (English / हिन्दी / தமிழ்) and light/dark/system theme are also in Settings.

## 5. Project structure

```
src/            React app: pages/, components/, hooks/, lib/ (supabase, upload queue, audio, wav, export), i18n/
functions/      Pages Functions: api/process-meeting.ts, api/health.ts, lib/ (Whisper, notes LLM, stages)
supabase/       migrations/ + seed.sql + config.toml
public/         PWA icons
tests/          Vitest unit and component tests
docs/           Workers AI measurements and design notes
```

UI strings live in `src/i18n/{en,hi,ta}.json`. A test enforces identical keys and placeholders across all three.
**The Hindi and Tamil translations were written by an AI and have not been reviewed by a native speaker. Please
have one review them before launch.**

## 6. Test checklist

Automated: `npm test` and `npm run typecheck` must pass. Manual (needs a live Supabase project and Pages/wrangler):

**Record in each language**
- [ ] English: record ~1 min, save; transcript is English, summary and action items make sense.
- [ ] Hindi (`Spoken language = हिन्दी`): transcript is in Devanagari; notes in English and again with "Same as meeting".
- [ ] Tamil: same checks in Tamil script.
- [ ] Mixed English-Hindi and English-Tamil speech: names and English terms survive; note any quality problems.
- [ ] Record >5 min (segments): the transcript timestamps continue across segment boundaries; clicking a line in the
      second segment seeks the audio to the right second.
- [ ] Pause/resume: timer excludes paused time. Recording stops itself at the length cap.
- [ ] Upload mp3, m4a, wav, webm files. A WAV over 5 min is processed in several parts; a non-WAV file over 16 MB is
      rejected with a clear message.
- [ ] iPhone Safari (mp4/m4a recording) and Android Chrome (webm). Screen-lock behaviour is a known browser limit.

**Offline upload**
- [ ] DevTools → Network → Offline, record and save: the app says it is queued and shows "waiting to upload".
- [ ] Reload while offline: the item is still queued. Go online: it uploads without interaction and appears in the list.
- [ ] Install the PWA, then open it offline: the app shell loads and the fonts still render.

**RLS check with two users** (sign in as user A in one browser profile, user B in another)
- [ ] A creates a meeting. B's dashboard doesn't show it. B opening `/meeting/<A's id>` shows "Meeting not found".
- [ ] B calls the API for A's meeting: `curl -X POST /api/process-meeting -H "Authorization: Bearer <B's token>" -d '{"meetingId":"<A's id>"}'`
      returns 404, and A's meeting is unchanged.
- [ ] With B's token, `GET <SUPABASE_URL>/rest/v1/meetings?id=eq.<A's id>` (apikey = anon key) returns `[]`;
      `PATCH` of `status` on B's own meeting is rejected (permission denied).
- [ ] B can't read A's audio: a signed URL request for `<A's uid>/…` fails; uploading to `<A's uid>/…` fails.
- [ ] No token (or an expired one) → `/api/process-meeting` returns 401.

**Failed-processing retry**
- [ ] Break it on purpose (e.g. temporarily set a wrong `SUPABASE_SERVICE_ROLE_KEY`, or process a corrupt audio file).
      The meeting shows **Failed** with a message and a **Retry** button.
- [ ] Fix the cause and press Retry: processing resumes from the first untranscribed part and finishes as Done,
      with no duplicated transcript lines.
- [ ] Close the tab mid-processing, reopen: the meeting shows **Resume** and completes.
- [ ] Exceed `MAX_MEETINGS_PER_DAY`: the extra meeting is refused with a clear message and isn't marked failed.

**Accounts and password reset**
- [ ] Create an account with name, e-mail and password: you are signed straight in (no e-mail step) and see "Waiting for approval".
- [ ] A weak password (short, letters only, digits only) is refused with a clear message; the same e-mail can't register twice.
- [ ] Wrong password and unknown e-mail show the same "Incorrect email or password."
- [ ] *Forgot password?* with a real address: the e-mail arrives, the link opens *Choose a new password*, the new password
      works and the old one doesn't. Opening the same link a second time shows the "expired" message and the reset form.
- [ ] *Forgot password?* with an unknown address shows the same confirmation (no hint whether it exists).
- [ ] Settings → Change password works. Switch the language to हिन्दी and தமிழ் on these screens.

**Admin approval**
- [ ] A brand-new account signs in and sees "Waiting for approval", with no Record/Meetings screens and no Admin link.
- [ ] The admin sees them under *Waiting for approval* and approves; the new user presses **Check again** (or returns to
      the tab) and gets the app. Revoke them: their next request returns no data and processing is refused with 403.
- [ ] A pending user calling `/api/process-meeting` with their own token gets 403; PATCHing their own `profiles.status`
      is rejected.

**Notes and sharing**
- [ ] Edit the title, summary and action items (tick, edit, add, delete); reload and the changes persist.
- [ ] Export → Copy as Markdown, Download .md / .txt, Share (try WhatsApp on a phone), with and without transcript.
- [ ] Delete audio after notes (Settings): after processing, the player is gone and the notes remain.
- [ ] Switch the interface to हिन्दी and தமிழ், and light/dark: no clipped or overlapping text at a 360 px width.

## 7. Known limitations

- Processing is driven by the open tab; closing it pauses processing until you press Resume.
- A tab crash mid-recording loses the current segment (completed segments are only saved after you stop).
- Segment boundaries in long recordings can clip a word.
- Non-WAV uploads are sent as one part (≤ 16 MB); long mp3/m4a files must be converted to WAV or split first.
- Speaker labels (`speaker_label`) are in the schema but not populated.
- Hindi/Tamil transcription and note quality have not been measured on real meeting audio.
