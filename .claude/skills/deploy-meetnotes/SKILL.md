---
name: deploy-meetnotes
description: Ship a MeetNotes change to production and prove it is live. Use when asked to deploy, push, release or publish, or after finishing a change that should go live. Covers checks, database migrations first, a secrets scan, commit and push to main, waiting for Cloudflare Pages, and verifying.
---

# Deploy MeetNotes

Production is **https://meetnotes.pages.dev**: a Cloudflare **Pages** project (`meetnotes`, production branch `main`) plus the Supabase project linked in `supabase/`. Pushing to `main` deploys the site and the functions in `functions/`. Database changes are separate and go first.

Only deploy when the user asked for it (or the change was requested as "go ahead", "commit it", "push it"). Never force-push or rewrite `main`.

## 1. Check locally (stop on a real failure)

```bash
npx tsc -b                        # app types
npx tsc -p functions/tsconfig.json   # server types
npx vitest run                    # about 340 tests, 3 to 8 minutes
npm run build
```

- Machine load can make vitest report `Failed to start forks worker` errors, or tests with absurd durations (hours) after the laptop slept. Rerun just the affected files (`npx vitest run tests/<file>`). A test that fails again is a real failure: fix it, do not skip it.
- Update `README.md` (and `docs/` if behaviour or limits changed) in the same change, plus the manual checklist in README when a screen changed.

## 2. Database migrations come first

If `supabase/migrations/` has a new file that is not yet applied:

```bash
npx supabase db push --linked --yes
```

- Migrations must be **additive** (new columns/tables/functions) so the old site keeps working while the new code deploys. Never edit a migration that was already pushed; add a new one.
- Features that use the scheduler need a row in `app_config` (for example `process_url`, `retention_url`) set with `npx supabase db query --linked "insert into public.app_config ..."`, and the `meetnotes_cron_secret` Vault secret. Without them the jobs do nothing (safe).
- The Supabase CLI needs `npx supabase login` and a linked project already done; if it asks to log in, ask the user to run `! npx supabase login`.

## 3. Scan for secrets before committing

```bash
git add -A
git diff --cached | grep -E "sb_secret_|eyJhbGci" && echo "STOP: secret in the diff"
```

- `.dev.vars` (service key, CRON_SECRET) and `.env.local` are gitignored and must stay that way.
- `.env.production` is committed and may hold **only public values** (Supabase URL and publishable key).
- Never print a key, token or secret in output, a commit message or a doc.

## 4. Commit and push

Small, logical commit; message explains the why. End the message with the attribution lines the session specifies. Then:

```bash
git push origin main
```

## 5. Wait for Cloudflare Pages and verify the new build is live

Poll the served bundle for a string that only the new build contains (a new UI label, an i18n string):

```bash
for i in $(seq 1 24); do
  js=$(curl -s https://meetnotes.pages.dev/ | grep -o 'assets/index-[^"]*\.js' | head -1)
  curl -s "https://meetnotes.pages.dev/$js" | grep -q "<new string>" && echo "LIVE: $js" && break
  sleep 15
done
```

- For a new API route, probe it: it should answer `401` without credentials (`curl -s -X POST https://meetnotes.pages.dev/api/<name> -w "%{http_code}"`), not 404.
- If nothing changes after about 6 minutes, Cloudflare may have missed the trigger: push an empty commit (`git commit --allow-empty -m "Trigger deploy"`). If the build itself failed, ask the user for the build log from the Cloudflare dashboard.
- The installed PWA picks up new versions on its own (an "Update" bar appears); a desktop browser may need two reloads.

## 6. Prove it works

Run the relevant live checks (see the `live-checks-meetnotes` skill), for example `npm run live -- template` after a notes change. Report honestly: what passed, what you did not test (for example anything needing a real phone).

## Environment and secrets (reference)

- Pages secrets are set with `npx wrangler pages secret bulk <json-file> --project-name meetnotes`, built from a temporary file that is deleted immediately. Names: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Optional variables: `MAX_MEETINGS_PER_DAY`, `MAX_RECORDING_MINUTES`, `LLM_MODEL`, `HINDI_FIX` (`off`), `FIX_MODEL`.
- `VITE_*` values are baked in at build time from `.env.production`.
- The Workers AI binding is `AI`. Free allowance is 10,000 units a day for the whole account; the app's own daily cap is under Admin, Usage and AI limit.

## Rollback

`git revert <commit>` and push. Database migrations are not undone by this: write a new migration that reverses them (for example drop a column only once nothing reads it).
