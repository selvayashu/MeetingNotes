---
name: live-checks-meetnotes
description: Run or add MeetNotes end-to-end checks against the deployed site and Supabase (sign-up approval, passwords, consent, transcript editing, meeting types, AI usage cap, account deletion, audio retention, background processing). Use after a deploy, when asked to verify something live, or when a change touches the database, an API route or processing.
---

# Live checks for MeetNotes

Unit tests (`npx vitest run`) cannot prove the deployed pieces work together: database policies, Pages functions, Workers AI, the scheduler. These scripts do, against **production** (`https://meetnotes.pages.dev` and the linked Supabase project).

## Run them

```bash
npm run live                       # quick set, about 12 minutes
npm run live -- delete retention   # just these
npm run live -- all                # also the slow background check (about 4 more minutes)
```

The runner prints one line per script (passed / failed counts) and the failing lines, then exits non-zero if anything failed. Long runs exceed a single tool timeout: run them in the background and read the output when notified.

| Name | Proves |
|---|---|
| `approval` | new accounts start pending; admin-only functions; approve/reject changes access |
| `password` | sign-in, reset rules, weak passwords refused |
| `consent` | recording-consent audit fields cannot be forged or changed |
| `edit` | transcript edits are tracked; notes can be regenerated after an edit |
| `template` | the owner can change a meeting type; the AI writes different notes (uses a few real AI calls) |
| `usage` | AI usage is metered; the daily cap pauses processing and resumes it; users cannot read usage |
| `cap-tick` | the real scheduler leaves meetings alone while the cap is reached (waits about 75 s) |
| `delete` | everything the data export reads is readable; account deletion removes accounts, meetings and audio and keeps anonymous usage |
| `retention` | the daily audio sweep deletes only expired audio of finished meetings and never another user's files |
| `background` (slow) | a 5-minute meeting finishes with no browser open |

Other live checks: `scripts/asr-experiments/live-hindi.mjs` (Hindi spelling clean-up on real Hindi speech).

## Requirements

- `.dev.vars` in the repo root with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (gitignored; never print or commit it) and the committed `.env.production`.
- `npx supabase` logged in and linked (the scripts use `npx supabase db query --linked`).
- AI cost: a few hundred Workers AI units per full run (the free allowance is 10,000 a day). Do not run them if the daily cap is already reached, or the processing checks will fail for that reason (look at Admin, Usage and AI limit).

## What they do to production

Each script creates throw-away users named `meetnotes-test-*@example.com` (and their meetings, files and usage rows) and deletes them in a `finally` block. The runner treats `test_users_left` above zero as a failure. After a run that was **killed** half-way, clean up by hand:

```bash
npx supabase db query --linked "delete from auth.users where email like 'meetnotes-test-%' returning email"
```

(also remove any `recordings` objects under those user ids if the script had uploaded audio). Real users are never touched; the scripts only act on the accounts they created.

## Reading a failure

1. Read the failing `FAIL ...` line and the extra text after it.
2. Rerun that one script once: Whisper and the LLM vary slightly, and the scheduler checks depend on timing.
3. A repeatable failure is real. Look at the Pages function logs and the Supabase logs, fix the cause, add a unit test where possible, redeploy (skill `deploy-meetnotes`), rerun.
4. If the cause was the check itself (a stale expectation), fix the script and say so; never silence a failing check without understanding it.

## Adding a check

Copy a small script such as `scripts/live-checks/consent.mjs`, then:

- Create users with `meetnotes-test-<label>-<random>@example.com`, approve them with SQL (`update public.profiles set status='approved' ...`) and sign in with the password grant using the publishable key. Act **as the user** to prove access rules, and with the service key only to set up and inspect.
- Print `PASS <what>` / `FAIL <what> <detail>` for each assertion and exit cleanly; the runner counts those lines.
- Clean up in a `finally`: storage objects, usage rows (`ai_usage` keeps rows after a user is deleted, so delete them by `meeting_id` or `user_id` first), then the auth users. Finish by printing a line with `test_users_left:<n>`.
- Keep the AI cost small (short audio such as `fixtures/speech.wav`).
- Register it in `QUICK` or `SLOW` in `scripts/live-checks/run.mjs` with a one-line description, and add it to the table above.
- Do not put keys, tokens or real people's data in a script.

## Things these checks cannot show

Anything needing a real phone or a person: recording on iPhone or Android, the installed app, how screens feel. See `docs/device-testing.md`.
