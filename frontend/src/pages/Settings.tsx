import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Loader2, RotateCw, Trash2, XCircle } from 'lucide-react';
import { api, ApiError, clearHealthCache, type Health } from '../lib/api';
import { loadBrowserModel, onModelLoad } from '../lib/browserStt';
import { db } from '../lib/db';
import { OUTPUT_LANGUAGES, SUMMARY_STYLES, TRANSCRIPTION_MODES, UI_LANGUAGES } from '../lib/languages';
import { processQueue } from '../lib/pipeline';
import { DEFAULT_SETTINGS, updateSettings, useSettings, type BrowserModel, type Settings, type SttMode, type Theme } from '../lib/settings';
import { toast } from '../lib/toast';

const BROWSER_MODELS: { id: BrowserModel; label: string }[] = [
  { id: 'onnx-community/whisper-tiny', label: 'Whisper tiny (~40 MB)' },
  { id: 'onnx-community/whisper-base', label: 'Whisper base (~80 MB)' },
  { id: 'onnx-community/whisper-small', label: 'Whisper small (~250 MB)' },
];

type Check = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; health: Health } | { state: 'error'; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const s = useSettings();
  const [serverUrl, setServerUrl] = useState(s.serverUrl);
  const [token, setToken] = useState(s.accessToken);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [models, setModels] = useState<string[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(null);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => updateSettings({ [key]: value } as Partial<Settings>);

  const testConnection = async () => {
    updateSettings({ serverUrl: serverUrl.trim(), accessToken: token.trim() });
    clearHealthCache();
    setCheck({ state: 'loading' });
    try {
      const health = await api.health(true);
      setCheck({ state: 'ok', health });
      api.models().then((r) => setModels(r.models)).catch(() => setModels([]));
      void processQueue();
    } catch (e) {
      const message =
        e instanceof ApiError && e.kind === 'auth' ? t('settings.authError') : e instanceof Error ? e.message : String(e);
      setCheck({ state: 'error', message });
    }
  };

  useEffect(() => {
    void testConnection();
    void refreshStorage();
    return onModelLoad((e) => {
      if (e.status === 'progress' && typeof e.progress === 'number') setModelProgress(e.progress);
    });
  }, []); // run once when the page opens

  const refreshStorage = async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      if (est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    } catch {
      setStorage(null);
    }
  };

  const downloadModel = async () => {
    setModelProgress(0);
    try {
      await loadBrowserModel(s.browserModel);
      toast(t('settings.modelReady'), 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setModelProgress(null);
      void refreshStorage();
    }
  };

  const deleteAll = async () => {
    if (!window.confirm(t('settings.confirmDeleteAll'))) return;
    await db.transaction('rw', db.meetings, db.audio, db.audioParts, async () => {
      await Promise.all([db.meetings.clear(), db.audio.clear(), db.audioParts.clear()]);
    });
    toast(t('settings.allDeleted'), 'success');
    void refreshStorage();
  };

  return (
    <div className="page settings">
      <h1>{t('settings.title')}</h1>

      <section className="card">
        <h2>{t('settings.server')}</h2>
        <label className="field">
          <span>{t('settings.serverUrl')}</span>
          <input type="url" inputMode="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://api.example.com" />
        </label>
        <label className="field">
          <span>{t('settings.accessToken')}</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={t('settings.optional')} />
          <span className="small muted">{t('settings.accessTokenHint')}</span>
        </label>
        <button type="button" className="btn" onClick={() => void testConnection()} disabled={check.state === 'loading'}>
          {check.state === 'loading' ? <Loader2 size={16} className="spin" aria-hidden /> : <RotateCw size={16} aria-hidden />} {t('settings.test')}
        </button>
        {check.state === 'ok' && (
          <div className="check-result ok">
            <CheckCircle2 size={18} aria-hidden />
            <div>
              <div>{t('settings.connected', { version: check.health.version })}</div>
              <div className="small muted">STT: {check.health.stt.default}{Object.keys(check.health.stt.routes).length ? ` · ${Object.entries(check.health.stt.routes).map(([k, v]) => `${k}→${v}`).join(', ')}` : ''}</div>
              <div className="small muted">
                LLM: {check.health.llm.reachable ? check.health.llm.default_model : check.health.llm.error}
                {` · ${t('settings.speakerLabels')}: ${check.health.diarization ? t('common.on') : t('common.off')}`}
              </div>
            </div>
          </div>
        )}
        {check.state === 'error' && (
          <div className="check-result error" role="alert">
            <XCircle size={18} aria-hidden />
            <div>
              <div>{t('settings.notConnected')}</div>
              <div className="small">{check.message}</div>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t('settings.transcription')}</h2>
        <label className="field">
          <span>{t('settings.transcriptionLanguage')}</span>
          <select value={s.transcriptionLanguage} onChange={(e) => set('transcriptionLanguage', e.target.value as Settings['transcriptionLanguage'])}>
            {TRANSCRIPTION_MODES.map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
          </select>
          <span className="small muted">{t('settings.mixedHint')}</span>
        </label>
        <label className="field">
          <span>{t('settings.sttMode')}</span>
          <select value={s.sttMode} onChange={(e) => set('sttMode', e.target.value as SttMode)}>
            <option value="auto">{t('settings.sttAuto')}</option>
            <option value="server">{t('settings.sttServer')}</option>
            <option value="browser">{t('settings.sttBrowser')}</option>
          </select>
        </label>
        {s.sttMode !== 'server' && (
          <div className="field">
            <span>{t('settings.browserModel')}</span>
            <select value={s.browserModel} onChange={(e) => set('browserModel', e.target.value as BrowserModel)}>
              {BROWSER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className="small muted">{t('settings.browserModelHint')}</span>
            <button type="button" className="btn small" onClick={() => void downloadModel()} disabled={modelProgress !== null}>
              {modelProgress !== null ? <Loader2 size={14} className="spin" aria-hidden /> : <Download size={14} aria-hidden />}{' '}
              {modelProgress !== null ? `${Math.round(modelProgress)}%` : t('settings.downloadModel')}
            </button>
          </div>
        )}
        <div className="field">
          <span>{t('settings.chunkLength', { min: s.chunkMinSec, max: s.chunkMaxSec })}</span>
          <div className="range-pair">
            <input type="range" min={3} max={10} value={s.chunkMinSec} aria-label={t('settings.chunkMin')}
              onChange={(e) => { const v = +e.target.value; updateSettings({ chunkMinSec: v, chunkMaxSec: Math.max(v + 1, s.chunkMaxSec) }); }} />
            <input type="range" min={5} max={20} value={s.chunkMaxSec} aria-label={t('settings.chunkMax')}
              onChange={(e) => { const v = +e.target.value; updateSettings({ chunkMaxSec: v, chunkMinSec: Math.min(v - 1, s.chunkMinSec) }); }} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.speakerLabels} onChange={(e) => set('speakerLabels', e.target.checked)} />
          <span>{t('settings.speakerLabels')} <span className="small muted">— {t('settings.speakerLabelsHint')}</span></span>
        </label>
      </section>

      <section className="card">
        <h2>{t('settings.notes')}</h2>
        <label className="field">
          <span>{t('settings.outputLanguage')}</span>
          <select value={s.outputLanguage} onChange={(e) => set('outputLanguage', e.target.value as Settings['outputLanguage'])}>
            {OUTPUT_LANGUAGES.map((l) => <option key={l} value={l}>{t(`output.${l}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('settings.summaryStyle')}</span>
          <select value={s.summaryStyle} onChange={(e) => set('summaryStyle', e.target.value as Settings['summaryStyle'])}>
            {SUMMARY_STYLES.map((x) => <option key={x} value={x}>{t(`styles.${x}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('settings.llmModel')}</span>
          <input list="llm-models" value={s.llmModel} onChange={(e) => set('llmModel', e.target.value.trim())}
            placeholder={check.state === 'ok' ? `${t('settings.serverDefault')}: ${check.health.llm.default_model}` : t('settings.serverDefault')} />
          <datalist id="llm-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          <span className="small muted">{t('settings.llmModelHint')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoNotes} onChange={(e) => set('autoNotes', e.target.checked)} />
          {t('settings.autoNotes')}
        </label>
      </section>

      <section className="card">
        <h2>{t('settings.appearance')}</h2>
        <label className="field">
          <span>{t('settings.uiLanguage')}</span>
          <select value={s.uiLanguage} onChange={(e) => set('uiLanguage', e.target.value as Settings['uiLanguage'])}>
            {UI_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('settings.theme')}</span>
          <select value={s.theme} onChange={(e) => set('theme', e.target.value as Theme)}>
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </label>
      </section>

      <section className="card">
        <h2>{t('settings.privacy')}</h2>
        <p className="small muted">{t('settings.privacyText')}</p>
        <label className="check">
          <input type="checkbox" checked={s.deleteAudioAfterTranscription} onChange={(e) => set('deleteAudioAfterTranscription', e.target.checked)} />
          {t('settings.deleteAudio')}
        </label>
        <label className="check">
          <input type="checkbox" checked={!s.consentRemembered} onChange={(e) => set('consentRemembered', !e.target.checked)} />
          {t('settings.showConsent')}
        </label>
        {storage && (
          <p className="small muted">
            {t('settings.storage', { used: formatBytes(storage.usage), quota: formatBytes(storage.quota) })}
            {' · '}
            {storage.persisted ? t('settings.persisted') : t('settings.notPersisted')}
          </p>
        )}
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={() => updateSettings({ ...DEFAULT_SETTINGS, serverUrl: s.serverUrl, accessToken: s.accessToken })}>
            {t('settings.reset')}
          </button>
          <button type="button" className="btn ghost danger" onClick={() => void deleteAll()}>
            <Trash2 size={16} aria-hidden /> {t('settings.deleteAll')}
          </button>
        </div>
      </section>

      <p className="small muted center">MeetNotes 1.0 · {t('settings.openSource')}</p>
    </div>
  );
}
