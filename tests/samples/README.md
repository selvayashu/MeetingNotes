# Transcription test samples

Put audio files and reference transcripts here, then list them in `manifest.csv`. Copy
`manifest.example.csv` to start. Everything in this folder except this README and the example
manifest is git-ignored, so recordings of real people stay private.

```
cp tests/samples/manifest.example.csv tests/samples/manifest.csv
python scripts/test_transcription.py --manifest tests/samples/manifest.csv --show
```

## Where to get samples

- **Your own recordings.** This is the best test. Record 30–60 s clips of the people and topics you
  care about, including Tamil–English and Hindi–English code-switching, and type the reference
  transcript by hand. Write English words in Latin script, as people would naturally write them.
- **Google FLEURS** (CC BY 4.0) on Hugging Face: `google/fleurs`, configs `en_us`, `hi_in`, `ta_in`.
- **Mozilla Common Voice** (CC0): English, Hindi and Tamil sets.
- **AI4Bharat Kathbath / IndicVoices** (open licences, see each dataset card) for Hindi and Tamil.

Real code-mixed data is scarce, so a handful of your own mixed recordings is the most useful test.

## Reading the results

- **CER** (character error rate) is the main metric for Tamil and Hindi. Their long, inflected words
  make WER look worse than the transcript actually is.
- **Latin% out/ref**: for `ta-en` and `hi-en`, this shows whether English words in the speech came
  out in English (similar percentages) or were transliterated into Tamil or Devanagari script
  (much lower output %).
- Compare runs before and after changing `WHISPER_MODEL` or `STT_ROUTES` (for example IndicWhisper
  for Tamil) to decide which model to use.
