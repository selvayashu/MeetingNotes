import { formatClock, transcriptText, type ActionItem, type Meeting } from './db';
import { LANGUAGE_NAMES } from './languages';

type T = (key: string, options?: Record<string, unknown>) => string;

export type Block =
  | { type: 'title'; text: string }
  | { type: 'meta'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'actions'; items: ActionItem[] }
  | { type: 'transcript'; items: { time: string; speaker?: string; text: string }[] };

export interface ExportOptions {
  transcript: boolean;
}

/** One document model, rendered to Markdown, PDF and print. */
export function buildDocument(meeting: Meeting, t: T, opts: ExportOptions): Block[] {
  const blocks: Block[] = [{ type: 'title', text: meeting.title }];
  const meta = [
    new Date(meeting.createdAt).toLocaleString(),
    `${t('meeting.duration')}: ${formatClock(meeting.durationMs / 1000)}`,
    meeting.detectedLanguage ? `${t('meeting.language')}: ${LANGUAGE_NAMES[meeting.detectedLanguage] ?? meeting.detectedLanguage}` : '',
    meeting.tags.length ? `${t('meeting.tags')}: ${meeting.tags.join(', ')}` : '',
  ].filter(Boolean);
  blocks.push({ type: 'meta', text: meta.join(' · ') });

  const notes = meeting.notes;
  if (notes) {
    if (notes.summary) blocks.push({ type: 'heading', text: t('notes.summary') }, { type: 'paragraph', text: notes.summary });
    if (notes.key_points.length) blocks.push({ type: 'heading', text: t('notes.keyPoints') }, { type: 'bullets', items: notes.key_points });
    if (notes.decisions.length) blocks.push({ type: 'heading', text: t('notes.decisions') }, { type: 'bullets', items: notes.decisions });
    if (notes.action_items.length) blocks.push({ type: 'heading', text: t('notes.actionItems') }, { type: 'actions', items: notes.action_items });
    if (notes.open_questions.length) blocks.push({ type: 'heading', text: t('notes.openQuestions') }, { type: 'bullets', items: notes.open_questions });
  }
  if (meeting.manualNotes.trim()) {
    blocks.push({ type: 'heading', text: t('meeting.myNotes') }, { type: 'paragraph', text: meeting.manualNotes.trim() });
  }
  if (meeting.bookmarks.length) {
    blocks.push({
      type: 'bullets',
      items: meeting.bookmarks.map((b) => `${formatClock(b.time)} ${b.label || t('record.bookmark')}`),
    });
    blocks.splice(blocks.length - 1, 0, { type: 'heading', text: t('meeting.bookmarks') });
  }
  if (opts.transcript) {
    blocks.push({ type: 'heading', text: t('tabs.transcript') });
    if (meeting.transcriptOverride !== undefined) {
      blocks.push({ type: 'paragraph', text: meeting.transcriptOverride });
    } else {
      blocks.push({
        type: 'transcript',
        items: meeting.segments.map((s) => ({ time: formatClock(s.start), speaker: s.speaker, text: s.text })),
      });
    }
  }
  return blocks;
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function toMarkdown(blocks: Block[], t: T): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'title':
        out.push(`# ${b.text}`);
        break;
      case 'meta':
        out.push(`_${b.text}_`);
        break;
      case 'heading':
        out.push(`## ${b.text}`);
        break;
      case 'paragraph':
        out.push(b.text);
        break;
      case 'bullets':
        out.push(b.items.map((i) => `- ${i}`).join('\n'));
        break;
      case 'actions':
        out.push(
          [
            `| | ${t('actions.task')} | ${t('actions.owner')} | ${t('actions.due')} |`,
            '|---|---|---|---|',
            ...b.items.map((a) => `| ${a.done ? '☑' : '☐'} | ${escapeCell(a.task)} | ${escapeCell(a.owner || '—')} | ${escapeCell(a.due_date || '—')} |`),
          ].join('\n'),
        );
        break;
      case 'transcript':
        out.push(b.items.map((i) => `**[${i.time}]**${i.speaker ? ` ${i.speaker}:` : ''} ${i.text}`).join('\n\n'));
        break;
    }
  }
  return out.join('\n\n') + '\n';
}

export function fileName(meeting: Meeting, ext: string): string {
  const date = new Date(meeting.createdAt).toISOString().slice(0, 10);
  const safe = meeting.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'meeting';
  return `${date} ${safe}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

/** Web Share API: shares the Markdown file where supported, else the text. Returns false if unavailable. */
export async function shareMeeting(meeting: Meeting, markdown: string): Promise<boolean> {
  if (!navigator.share) return false;
  const file = new File([markdown], fileName(meeting, 'md'), { type: 'text/markdown' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: meeting.title, files: [file] });
    } else {
      await navigator.share({ title: meeting.title, text: markdown });
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return true; // user closed the sheet
    throw e;
  }
  return true;
}

export { transcriptText };
