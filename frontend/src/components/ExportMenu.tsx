import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileDown, FileText, Printer, Share2, ChevronDown } from 'lucide-react';
import type { Meeting } from '../lib/db';
import { buildDocument, copyText, downloadBlob, fileName, shareMeeting, toMarkdown } from '../lib/export';
import { toast } from '../lib/toast';

export default function ExportMenu({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const doc = (transcript = includeTranscript) => buildDocument(meeting, t, { transcript });
  const labels = { owner: t('actions.owner'), due: t('actions.due') };

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await action();
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Share2 size={16} aria-hidden /> {t('export.button')} <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          <label className="check menu-check">
            <input type="checkbox" checked={includeTranscript} onChange={(e) => setIncludeTranscript(e.target.checked)} />
            {t('export.includeTranscript')}
          </label>
          <button type="button" role="menuitem" disabled={busy} onClick={() => run(async () => {
            await copyText(toMarkdown(doc(), t));
            toast(t('export.copied'), 'success');
          })}>
            <Copy size={16} aria-hidden /> {t('export.copy')}
          </button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => run(() => {
            downloadBlob(new Blob([toMarkdown(doc(), t)], { type: 'text/markdown;charset=utf-8' }), fileName(meeting, 'md'));
          })}>
            <FileText size={16} aria-hidden /> {t('export.markdown')}
          </button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => run(async () => {
            const { downloadPdf } = await import('../lib/pdf');
            await downloadPdf(doc(), fileName(meeting, 'pdf'), {
              ...labels,
              page: (page, total) => t('export.page', { page, total }),
            });
          })}>
            <FileDown size={16} aria-hidden /> {busy ? t('common.working') : t('export.pdf')}
          </button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => run(async () => {
            const { printDocument, toHtml } = await import('../lib/pdf');
            printDocument(toHtml(doc(), labels));
          })}>
            <Printer size={16} aria-hidden /> {t('export.print')}
          </button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => run(async () => {
            const markdown = toMarkdown(doc(), t);
            if (!(await shareMeeting(meeting, markdown))) {
              await copyText(markdown);
              toast(t('export.shareUnsupported'), 'info');
            }
          })}>
            <Share2 size={16} aria-hidden /> {t('export.share')}
          </button>
        </div>
      )}
    </div>
  );
}
