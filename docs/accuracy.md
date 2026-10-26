# Speech-to-text accuracy (measured 2026-10-25)

Model `@cf/openai/whisper-large-v3-turbo` with the production options (`vad_filter: true`, `condition_on_previous_text: false`),
on 20 test clips per language from [Google FLEURS](https://huggingface.co/datasets/google/fleurs) (CC-BY 4.0).
Reproduce: `scripts/benchmark-asr.mjs`.

| Language | Clips | WER (hint) | CER (hint) | Median clip WER | WER (auto-detect) | Language auto-detected |
|---|---|---|---|---|---|---|
| Hindi | 20 (7.8 min) | 29.4% | 10.1% | 33.3% | 49.3% | 75.0% |
| Tamil | 16 (7.6 min) | 77.0% | 27.9% | 76.9% | 78.8% | 100.0% |
| English | 20 (6.3 min) | 5.5% | 2.7% | 6.3% | 5.5% | 100.0% |

WER = word error rate, CER = character error rate (lower is better). Both texts are lower-cased and stripped of punctuation first.
"hint" is what the app does when you pick a spoken language; "auto-detect" is the default **Auto-detect** option.

## Hallucination check (no speech in the audio)

| Audio | Language setting | Output |
|---|---|---|
| 10 s of silence | hi | empty |
| 10 s of silence | ta | empty |
| 10 s of silence | auto | empty |
| 10 s of faint noise | hi | empty |
| 10 s of faint noise | ta | empty |
| 10 s of faint noise | auto | empty |

## Worst clips with a language hint

- **Hindi** (clip WER 39.3%)
  - reference: पुरुषों के स्टैंडिंग सुपर-जी में ऑस्ट्रेलिया के मिशेल गौरले ग्यारहवें स्थान पर रहे. चेक प्रतियोगी ओल्डरिच जेलिनेक पुरुषों के सिटिंग सुपर-जी में सोलहवें स्थान पर रहे.
  - Whisper:   पुरिशों के स्टेंडिंग सुपर जी में आस्ट्रेलिया के मिशल गौरले 11 स्थान पर रहे चेक प्रतियोगी और्डिच जैली नेक पुरिशों के सिटिंग सुपर जी में सोल में स्थान पर रहे
- **Hindi** (clip WER 38.9%)
  - reference: MS, बीमारी केंद्रीय तंत्रिका तंत्र पर असर करती है, जिसमें दिमाग, स्पाइनल कॉर्ड और ऑप्टिक नर्व शामिल हैं.
  - Whisper:   MS, बीमारी के इंद्रिय तंत्र का तंत्र पर असर करती है जिसमें दिमांग, स्पाइनल कॉर्ड और आप्टिक नर्व शामिल है
- **Tamil** (clip WER 126.7%)
  - reference: நீங்கள் உங்கள் சொந்த கருத்தைத் தவிர அரசாங்கங்களின் ஆலோசனையை பெற விரும்பலாம், ஆனால் அவர்களின் ஆலோசனை அவர்களின் குடிமக்களுக்கென உருவாக்கப்பட்டுள்ளது.
  - Whisper:   நீங்கள்rak உங்கள் சொந்த கருத்தைத் தவி Achoمرுங்களின் அலம் சனையிர் Apps விரும்பலாம் ஆனால் அவர PHIL соп Clap ஓ doubledின் அலம் சனையிர் pollen அலம் சனைக்கலின் உருவாகப் NARRATORல்லது
- **Tamil** (clip WER 103.8%)
  - reference: "வலைப்பதிவுகளின் சரியான பயன்பாடு ""மாணவர்களை மேலும் விமர்சகர்களாகவும், பகுத்தாய்பவர்களாகவும் ஆக்கும்; இணைய கேள்விகளுக்கு பதிலளிக்கும் போது அவர்கள் அடுதவர்களுடைய கருத்துக்கு தங்கள் பதிலைச் சொல்வதுடன், தங்களுக்கே உரிய ஒரு நிலையை எடுக்கவும் உதவுகிறது"" (ஓராவேக் 2002). "
  - Whisper:   வலை பதிவுகளின் சரியான பயன்பாடு, மானவர்களை மேலும் விமர σουதர்களாக வும் பகுத்தாய்பவர்களாக வும் ஆக Iranian நடமிம் எனைய கேல்விகளுக்கு பதிலிலிக்கும் போது, அவர்கள் அடுத்த grated scrutक guardingதிர்ereumகின் разныхbetween தங்களிலை சொல்வத솟ன் தங்களுக்கே உரியே ஒர் நிலையை எடுக்கவும் உதவியிறது ஒராவேக் இரண்டாயிரத்தி இரண்டு
- **English** (clip WER 13.6%)
  - reference: The city is also the base to climb the Nyiragongo volcano along with some of the cheapest Mountain Gorilla tracking in Africa.
  - Whisper:   The city is also the base to climb the Nairaigango volcano along with some of the cheapest mountain guerrilla trafficking in Africa.
- **English** (clip WER 12.5%)
  - reference: The Northern Marianas emergency management office said that there were no damages reported in the nation.
  - Whisper:   The Northern Mariana's Emergency Management Office said that there were no damages reported in the nation.

## How to read this
- FLEURS is clean read speech by native speakers. **Real meetings (several voices, noise, interruptions, Hindi-English or Tamil-English mixing) will be worse**; treat these numbers as a best case.
- Tamil is agglutinative, so word error rate looks harsher than character error rate; judge it by CER.
- Code-switched (Hinglish/Tanglish) speech is **not** measured here. Test it with a few real recordings before promising it.

## Can a different Whisper setting fix it? (tested 2026-10-25)

Same clips, Hindi and Tamil, language hint on. **The identical baseline scored 29.4% / 10.1% (Hindi) and 77.0% / 27.9% (Tamil)
in the first run and 34.9% / 16.6% and 77.7% / 34.0% in the second**, so Whisper's output varies by several points from run to run.
Treat differences smaller than about 6 points as noise.

| Variant | Hindi WER / CER | Tamil WER / CER |
|---|---|---|
| baseline (production: `vad_filter` on, `condition_on_previous_text` off) | 34.9% / 16.6% | 77.7% / 34.0% |
| `vad_filter` off | 32.4% / 11.4% | 85.3% / 46.8% |
| in-language `initial_prompt` | 30.0% / 10.3% | 74.5% / 33.0% |
| `beam_size` 10 | 30.0% / 10.6% | 95.3% / 41.5% |
| `vad_filter` off + prompt | 31.5% / 11.9% | 74.5% / 36.0% |
| stricter filters (`compression_ratio_threshold` 2.0, `log_prob_threshold` -0.8) | 30.0% / 10.4% | 165.8% / 90.7% |

**Conclusion:** no setting gives a reliable improvement, so production keeps the baseline. Hindi sits around 30% word / 10-15% character
errors and Tamil around 75% word / 30% character errors whatever we try. The remaining limit is the model
(`whisper-large-v3-turbo`) on Tamil. Tamil output also contains stray words in other scripts (see the worst clips above), which looks like
decoding drift rather than mishearing.

**What helps in practice (measured):** choosing the spoken language instead of Auto-detect. For Hindi, auto-detect picked the wrong
language 25% of the time and raised word errors from about 30% to 49%. The Record page now remembers your last choice.

**If Tamil quality matters for your users,** the next things to try are a larger or Indic-specific speech model (usually not free), or
letting users correct the transcript (planned: transcript editing).

## Improving Hindi and Tamil (tested 2026-10-28)

Reproduce with `scripts/asr-experiments/` (see its README). Clips are FLEURS (12 per language unless noted). Whisper varies by several points
between runs, so only differences above about 6 points are real. **The baseline moved between 28% and 31% for Hindi and between 79% and 94% for Tamil
on these clips.**

### Other speech models
| Model | Hindi WER / CER | Tamil WER / CER | Cost (Workers AI) |
|---|---|---|---|
| `whisper-large-v3-turbo` (production) | 28.4% / 10.0% (8 clips) | 86.9% / 44.1% (8 clips) | about 47 neurons per audio minute |
| `@cf/openai/whisper` (older) | 134.8% / 125.5% | 89.3% / 49.3% | cheaper, but unusable for Hindi (no language hint, wrong output) |
| `@cf/deepgram/nova-3` | **15.9% / 9.4%** (8 clips) | **not supported** (error 8007) | **about 473 neurons per audio minute, 10 times Whisper** |

Nova-3 is clearly better for Hindi in word errors (character errors are about the same, so part of the gain is spelling and word boundaries) but would use up the
free 10,000 units a day after about 21 minutes of audio, and it cannot do Tamil at all. It is **not used**; it is the option to consider if Hindi quality is worth paying for.

### Free post-processing of Whisper's text
| Variant | Hindi WER / CER | Tamil WER / CER |
|---|---|---|
| Whisper as is | 29.8% / 10.8% | 79.1% / 36.1% |
| drop words in other or mixed scripts | 29.8% / 10.8% | 74.4% / 36.3% |
| LLM spelling correction, Llama 3.3 70B | 21.0% / 8.9% (15.7% / 6.7% with a looser prompt) | 68.4% / 34.4% |
| LLM spelling correction, Llama 3.1 8B | **20.4% / 9.0%** | 70.2% / 36.8% |

- The LLM is told to fix only clearly wrong spellings and to keep names, numbers and English words. The 8B model is about as good as the 70B one for Hindi at
  one sixth of the price, so it is the one used.
- **Is it just remembering the test sentences?** FLEURS sentences come from Wikipedia, which the model may have seen. So it was also tested on 16 Hindi
  meeting sentences written for this test (some with English words mixed in), deliberately damaged with typical Whisper-style spelling errors:
  word errors **23.8% before, 8.8% after** (8B) and 7.7% (70B). It does generalise.
- **What it gets wrong:** on already-correct text it still changes about 5 to 9% of words, mostly respelling English words in Devanagari ("client" becomes
  "क्लाइंट") or small wording changes. That is why every line is checked and why Whisper's own text is kept next to every changed line.
- **Tamil:** word errors improve by about 9 to 11 points but character errors barely move (36.1% to 34.4 to 36.8%). The words are still mostly wrong, so
  it is not worth the cost and is **not applied**.

### What shipped (Hindi only)
After Whisper, Hindi meetings (chosen as Hindi, or Auto-detect that detected Hindi) go through the 8B spelling pass in batches of about 20 lines
(`functions/lib/fixText.ts`). A corrected line is accepted only if it is plausible: similar length, still mostly Devanagari, and at most half of its words changed.
Any failure keeps Whisper's text. Corrected lines store Whisper's original in `transcript_segments.asr_text`, and the Transcript tab says the spelling
was improved automatically. Turn it off with the `HINDI_FIX=off` variable; change the model with `FIX_MODEL`.

**Measured on the deployed site** with 58 seconds of real Hindi speech: word errors 31.7% to 18.7% (character errors 9.7% to 9.9%, unchanged).
**Cost:** about 35% more AI units on top of Whisper for Hindi meetings (45 units of speech plus about 16 of text in that test).

### Tamil: what is left
No free option helped. Whisper large-v3-turbo is the limit (about 80% word and 35% character errors) and Workers AI has no better Tamil model.
Options that need a decision and money or hosting: a cloud speech service with Tamil support (for example Google Cloud Speech-to-Text or Azure Speech),
or hosting an Indic model such as AI4Bharat's IndicConformer yourself. Until then the app labels Tamil as experimental and the transcript can be edited.
