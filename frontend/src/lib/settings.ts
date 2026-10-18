import { useSyncExternalStore } from 'react';
import type { OutputLanguage, SummaryStyle, TranscriptionMode, UiLanguage } from './languages';

export type SttMode = 'server' | 'browser' | 'auto';
export type BrowserModel = 'onnx-community/whisper-tiny' | 'onnx-community/whisper-base' | 'onnx-community/whisper-small';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  serverUrl: string;
  accessToken: string;
  sttMode: SttMode;
  browserModel: BrowserModel;
  transcriptionLanguage: TranscriptionMode;
  uiLanguage: UiLanguage;
  outputLanguage: OutputLanguage;
  summaryStyle: SummaryStyle;
  llmModel: string; // '' = server default
  autoNotes: boolean;
  deleteAudioAfterTranscription: boolean;
  speakerLabels: boolean;
  chunkMinSec: number;
  chunkMaxSec: number;
  theme: Theme;
  consentRemembered: boolean;
}

function defaultServerUrl(): string {
  const fromEnv = import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  return `${location.protocol}//${location.hostname}:8000`;
}

function defaultUiLanguage(): UiLanguage {
  const lang = (navigator.language || 'en').slice(0, 2);
  return lang === 'hi' || lang === 'ta' ? lang : 'en';
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: defaultServerUrl(),
  accessToken: '',
  sttMode: 'auto',
  browserModel: 'onnx-community/whisper-base',
  transcriptionLanguage: 'auto',
  uiLanguage: defaultUiLanguage(),
  outputLanguage: 'same',
  summaryStyle: 'concise',
  llmModel: '',
  autoNotes: true,
  deleteAudioAfterTranscription: false,
  speakerLabels: false,
  chunkMinSec: 5,
  chunkMaxSec: 10,
  theme: 'system',
  consentRemembered: false,
};

const KEY = 'meetnotes.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* settings still apply for this session */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
