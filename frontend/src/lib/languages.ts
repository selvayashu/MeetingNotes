export type TranscriptionMode = 'auto' | 'en' | 'hi' | 'ta' | 'ta-en' | 'hi-en';
export type UiLanguage = 'en' | 'hi' | 'ta';
export type OutputLanguage = 'same' | 'en' | 'hi' | 'ta';
export type SummaryStyle = 'concise' | 'detailed' | 'bullet';

export const TRANSCRIPTION_MODES: TranscriptionMode[] = ['auto', 'en', 'hi', 'ta', 'ta-en', 'hi-en'];
export const OUTPUT_LANGUAGES: OutputLanguage[] = ['same', 'en', 'hi', 'ta'];
export const SUMMARY_STYLES: SummaryStyle[] = ['concise', 'detailed', 'bullet'];

export const UI_LANGUAGES: { code: UiLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
];

/** Native names, used when showing a detected language. */
export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்' };

/** Whisper language code for the in-browser model; null lets Whisper detect it (also used for mixed speech). */
export function whisperLanguageFor(mode: TranscriptionMode): string | null {
  return mode === 'en' || mode === 'hi' || mode === 'ta' ? mode : null;
}
