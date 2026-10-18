import type { Block } from './export';

/**
 * PDF export that renders Tamil and Devanagari correctly.
 *
 * PDF libraries in the browser (jsPDF, pdf-lib) do not perform OpenType shaping, so Tamil and
 * Devanagari conjuncts and vowel signs come out broken. Instead we lay text out ourselves and draw
 * it on a canvas, where the browser shapes it with the bundled Noto Sans Tamil / Noto Sans
 * Devanagari fonts, then place each page in an A4 PDF with jsPDF.
 */

const PAGE_W = 794; // A4 at 96 dpi
const PAGE_H = 1123;
const MARGIN = 64;
const SCALE = 2;
const FONT_STACK = '"Noto Sans", "Noto Sans Devanagari", "Noto Sans Tamil", sans-serif';

const STYLES = {
  title: { size: 24, weight: 600, color: '#111827', gapBefore: 0, gapAfter: 6, lineHeight: 1.3 },
  meta: { size: 11, weight: 400, color: '#6b7280', gapBefore: 0, gapAfter: 18, lineHeight: 1.5 },
  heading: { size: 16, weight: 600, color: '#4338ca', gapBefore: 14, gapAfter: 6, lineHeight: 1.4 },
  body: { size: 12, weight: 400, color: '#1f2937', gapBefore: 0, gapAfter: 6, lineHeight: 1.6 },
  small: { size: 11, weight: 400, color: '#374151', gapBefore: 0, gapAfter: 4, lineHeight: 1.55 },
} as const;
type Style = (typeof STYLES)[keyof typeof STYLES];

async function ensureFonts(): Promise<void> {
  if (!document.fonts) return;
  const samples: [string, string][] = [
    ['Noto Sans', 'Meeting'],
    ['Noto Sans Devanagari', 'बैठक के नोट्स'],
    ['Noto Sans Tamil', 'கூட்டக் குறிப்புகள்'],
  ];
  await Promise.all(
    samples.flatMap(([family, text]) =>
      [400, 600].map((w) => document.fonts.load(`${w} 16px "${family}"`, text).catch(() => [])),
    ),
  );
  await document.fonts.ready;
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** Greedy word wrap; words wider than a line are broken between grapheme clusters (never inside one). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= width) {
        line = word;
        continue;
      }
      line = '';
      for (const g of graphemes(word)) {
        if (ctx.measureText(line + g).width > width && line) {
          lines.push(line);
          line = g;
        } else {
          line += g;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

class PageWriter {
  pages: HTMLCanvasElement[] = [];
  private ctx!: CanvasRenderingContext2D;
  private y = 0;

  constructor() {
    this.newPage();
  }

  private newPage() {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W * SCALE;
    canvas.height = PAGE_H * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'top';
    this.pages.push(canvas);
    this.ctx = ctx;
    this.y = MARGIN;
  }

  private font(style: Style) {
    this.ctx.font = `${style.weight} ${style.size}px ${FONT_STACK}`;
    this.ctx.fillStyle = style.color;
  }

  text(text: string, style: Style, opts: { indent?: number; prefix?: string; keepWithNext?: number } = {}) {
    const indent = opts.indent ?? 0;
    this.font(style);
    const lines = wrap(this.ctx, text, PAGE_W - 2 * MARGIN - indent);
    const lineH = style.size * style.lineHeight;
    this.y += style.gapBefore;
    // Keep headings with the first lines of what follows.
    if (this.y + lineH * (1 + (opts.keepWithNext ?? 0)) > PAGE_H - MARGIN && this.y > MARGIN) this.newPage();
    lines.forEach((line, i) => {
      if (this.y + lineH > PAGE_H - MARGIN) {
        this.newPage();
        this.font(style);
      }
      if (i === 0 && opts.prefix) this.ctx.fillText(opts.prefix, MARGIN + indent - 14, this.y);
      this.ctx.fillText(line, MARGIN + indent, this.y);
      this.y += lineH;
    });
    this.y += style.gapAfter;
  }

  footer(label: (page: number, total: number) => string) {
    const total = this.pages.length;
    this.pages.forEach((canvas, i) => {
      const ctx = canvas.getContext('2d')!;
      ctx.font = `400 9px ${FONT_STACK}`;
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'right';
      ctx.fillText(label(i + 1, total), PAGE_W - MARGIN, PAGE_H - MARGIN / 2);
    });
  }
}

export async function downloadPdf(
  blocks: Block[],
  filename: string,
  labels: { owner: string; due: string; page: (page: number, total: number) => string },
): Promise<void> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), ensureFonts()]);
  const w = new PageWriter();
  for (const b of blocks) {
    switch (b.type) {
      case 'title':
        w.text(b.text, STYLES.title);
        break;
      case 'meta':
        w.text(b.text, STYLES.meta);
        break;
      case 'heading':
        w.text(b.text, STYLES.heading, { keepWithNext: 2 });
        break;
      case 'paragraph':
        w.text(b.text, STYLES.body);
        break;
      case 'bullets':
        b.items.forEach((item) => w.text(item, STYLES.body, { indent: 16, prefix: '•' }));
        break;
      case 'actions':
        b.items.forEach((a) => {
          const details = [a.owner && `${labels.owner}: ${a.owner}`, a.due_date && `${labels.due}: ${a.due_date}`].filter(Boolean).join(' · ');
          w.text(details ? `${a.task}\n${details}` : a.task, STYLES.body, { indent: 16, prefix: a.done ? '☑' : '☐' });
        });
        break;
      case 'transcript':
        b.items.forEach((i) => w.text(`[${i.time}] ${i.speaker ? `${i.speaker}: ` : ''}${i.text}`, STYLES.small));
        break;
    }
  }
  w.footer(labels.page);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  w.pages.forEach((canvas, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, width, height, undefined, 'FAST');
  });
  pdf.setProperties({ title: filename.replace(/\.pdf$/, ''), creator: 'MeetNotes' });
  pdf.save(filename);
}

/** Browser print dialog ("Save as PDF") for a text-selectable PDF, using the same document model. */
export function printDocument(html: string): void {
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = html;
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    root.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  void ensureFonts().then(() => window.print());
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function toHtml(blocks: Block[], labels: { owner: string; due: string }): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'title':
          return `<h1>${esc(b.text)}</h1>`;
        case 'meta':
          return `<p class="meta">${esc(b.text)}</p>`;
        case 'heading':
          return `<h2>${esc(b.text)}</h2>`;
        case 'paragraph':
          return `<p>${esc(b.text).replace(/\n/g, '<br>')}</p>`;
        case 'bullets':
          return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
        case 'actions':
          return `<ul class="actions">${b.items
            .map((a) => `<li>${a.done ? '☑' : '☐'} ${esc(a.task)}${a.owner ? ` — ${esc(labels.owner)}: ${esc(a.owner)}` : ''}${a.due_date ? ` — ${esc(labels.due)}: ${esc(a.due_date)}` : ''}</li>`)
            .join('')}</ul>`;
        case 'transcript':
          return b.items.map((i) => `<p class="seg"><b>[${esc(i.time)}]</b> ${i.speaker ? `${esc(i.speaker)}: ` : ''}${esc(i.text)}</p>`).join('');
      }
    })
    .join('\n');
}
