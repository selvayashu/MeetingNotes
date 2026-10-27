# Hindi and Tamil text review

MeetNotes' Hindi and Tamil wording was written by an AI assistant and has **not** been checked by a native speaker. This folder is how to fix that.

## For the reviewer (about 1 to 2 hours per language)

You need: Excel, Google Sheets or LibreOffice, and the file for your language: `review-hi.csv` (Hindi) or `review-ta.csv` (Tamil). No coding needed.

1. Read `terms-hi.md` / `terms-ta.md` first. These ten words appear on many screens. Correct them if a better word is in common use.
2. Open the CSV. Each row is one piece of text, grouped by screen:
   - **English**: the original.
   - **Current text**: what the app shows today.
   - **Corrected text**: write your improved version here **only if the current text needs changing**. Leave it empty if it is fine.
   - **Comment**: optional, for anything you want to say (for example "sounds too formal").
3. Things to check, in this order:
   - Is it correct and natural for an ordinary office worker? (Not stiff or machine-translated.)
   - Is the same term used for the same thing everywhere?
   - Is the tone right? Warnings, such as the recording-consent notice and "delete my account", must be clear and serious.
   - Can a button label be understood in two or three words?
4. Also answer the questions in `questions.md` (a few minutes).
5. Keep `{placeholders}` such as `{n}` or `{email}` exactly as they are. They are filled in by the app (names, numbers, dates). You can move them to wherever your grammar needs them.
6. The **Sample meeting** rows are example content (a made-up meeting about a website launch). Make them sound like a real meeting in your language.
7. Save as **CSV UTF-8** (in Excel: *Save As, CSV UTF-8*; do not use plain "CSV", which breaks Hindi and Tamil letters) and send it back.

## For the developer

```
npm run i18n:export                                   # regenerate the sheets from the current text
npm run i18n:apply -- hi path/to/filled-in.csv --dry-run   # preview what would change, and any problems
npm run i18n:apply -- hi path/to/filled-in.csv             # apply (also: ta)
npm test                                              # keys and {placeholders} are checked in all three languages
```

`apply` only changes rows that have corrected text, refuses a correction that drops or renames a `{placeholder}`, ignores unknown keys, keeps the file's layout, and prints reviewer comments so none is lost. Regenerate the sheets after adding strings, and only send a reviewer the latest ones.
