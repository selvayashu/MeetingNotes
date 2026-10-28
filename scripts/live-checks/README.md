# Live checks

End-to-end checks against the deployed site and the Supabase project. Run with `npm run live` (see the header of `run.mjs`), or read the skill in
`.claude/skills/live-checks-meetnotes/SKILL.md` for what each script proves, what it does to production (throw-away `meetnotes-test-*` users, always removed), and how to add one.

`fixtures/speech.wav` is an 18-second synthetic English sample used by the processing checks (the background check repeats it to make 5 minutes).
