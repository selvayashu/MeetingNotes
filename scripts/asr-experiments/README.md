# Speech accuracy experiments

Scripts behind the Hindi/Tamil findings in `docs/accuracy.md`. They use your Cloudflare Workers AI allowance (the numbers are in each section of that file).

1. In one terminal: `cd scripts/asr-bench && npx wrangler dev --remote --port 8799`
2. In another: `node scripts/asr-experiments/run2.mjs 8` (and so on). Test clips (Google FLEURS) are downloaded once into your temp folder.

| Script | Question |
|---|---|
| `run1.mjs` | Other Whisper variants and Deepgram Nova-3 vs production |
| `run2.mjs` | Nova-3 vs production Whisper on identical clips |
| `run3.mjs` | Can stray-script filtering or an LLM spelling pass help? |
| `run4.mjs` | Which model should do the spelling pass; does it damage correct text? |
| `run5.mjs` | Does the spelling pass work on text the model cannot have memorised? |
| `live-hindi.mjs` | End-to-end check of the deployed site (needs `.dev.vars` and `.env.production`; creates and deletes a test user) |
