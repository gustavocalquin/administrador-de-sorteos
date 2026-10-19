import { money } from '../domain/catalog';
import { gridLayout, MAX_GRAPHIC_BYTES, MAX_GRAPHIC_PAGES, publicConditionSections, type GraphicImage, type PublicRaffle } from '../domain/graphics';

export type Measure = (text: string, size: number, bold?: boolean) => number;
export type Drawing = { type: 'text'; text: string; x: number; y: number; size: number; color: string; bold?: boolean }
  | { type: 'box'; x: number; y: number; w: number; h: number; color: string; radius?: number }
  | { type: 'image'; x: number; y: number; w: number; h: number; source: string };
export interface GraphicPage { kind: GraphicImage['kind']; title: string; drawings: Drawing[]; values: number[] }
const palettes = {
  bosque: { bg: '#f5f6ed', ink: '#123f34', light: '#dcebdc', accent: '#b47e1b' },
  oceano: { bg: '#eff6fc', ink: '#123c61', light: '#d5e7f3', accent: '#9a5b19' },
  ciruela: { bg: '#faf0f6', ink: '#542545', light: '#eed6e7', accent: '#9c5b19' },
};
export function wrapText(text: string, size: number, width: number, measure: Measure, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (!word) continue;
      if (measure(line ? `${line} ${word}` : word, size, bold) <= width) { line = line ? `${line} ${word}` : word; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && measure(line + char, size, bold) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
function shortened(lines: string[], count: number, size: number, width: number, measure: Measure) {
  if (lines.length <= count) return lines;
  const shown = lines.slice(0, count); let end = shown.at(-1)!;
  while (end && measure(`${end}…`, size, true) > width) end = end.slice(0, -1);
  shown[count - 1] = `${end}…`; return shown;
}
export function planGraphics(s: PublicRaffle, measure: Measure): GraphicPage[] {
  const layout = gridLayout(s); const c = palettes[s.palette]; const pages: GraphicPage[] = [];
  const states = new Map(s.numbers.map(n => [n.value, n.status]));
  const box = (d: Drawing[], x: number, y: number, w: number, h: number, color: string, radius = 0) => d.push({ type: 'box', x, y, w, h, color, radius });
  const text = (d: Drawing[], value: string, x: number, y: number, size = 36, bold = false, color = c.ink) => d.push({ type: 'text', text: value, x, y, size, bold, color });
  const lines = (d: Drawing[], values: string[], x: number, y: number, size: number, bold = false) => values.forEach((v, i) => text(d, v, x, y + i * (size * 1.3), size, bold));
  const contact = wrapText(s.contact, 32, 936, measure);
  if (contact.length > 3) throw new Error('El contacto público ocupa más de tres líneas. Acortalo antes de generar para que sea legible en cada imagen.');
  function background(d: Drawing[]) {
    box(d, 0, 0, 1080, 1920, c.bg);
    if (s.template === 'moderna') box(d, 0, 0, 26, 1920, c.ink);
    else if (s.template === 'minimalista') { box(d, 72, 78, 96, 8, c.accent); box(d, 72, 108, 936, 2, c.ink); }
    else if (s.template === 'elegante') { box(d, 32, 32, 1016, 1856, c.ink); box(d, 44, 44, 992, 1832, c.bg); box(d, 72, 82, 936, 8, c.accent); }
    else if (s.template === 'colorida') {
      box(d, 0, 0, 1080, 300, c.light);
      for (let i = 0; i < 8; i++) box(d, 72 + i * 122, 70 + (i % 2) * 24, 54, 54, i % 3 === 0 ? c.accent : c.ink, 27);
    } else {
      box(d, 0, 0, 1080, 28, c.ink);
      if (s.template === 'festiva') for (let i = 0; i < 9; i++) box(d, 75 + i * 110, 75 + (i % 2) * 14, 18, 18, i % 2 ? c.accent : c.ink, 5);
    }
  }
  function heading(d: Drawing[], tag: string) {
    if (s.template === 'colorida') { box(d, 72, 142, 390, 54, c.ink, 27); text(d, tag, 96, 153, 24, true, '#ffffff'); }
    else text(d, tag, 72, 160, 28, true);
    const nameWidth = s.image ? 700 : 936;
    lines(d, shortened(wrapText(s.name, 52, nameWidth, measure, true), 2, 52, nameWidth, measure), 72, 212, 52, true);
    if (s.image) d.push({ type: 'image', source: s.image, x: 828, y: 145, w: 160, h: 160 });
    text(d, `${money(s.price)} por número`, 72, 360, 40, true);
    lines(d, contact, 72, 422, 32);
  }
  const state = s.status === 'borrador' ? 'BORRADOR' : s.status === 'pausado' ? 'VENTAS PAUSADAS' : s.status === 'activo' ? 'VENTAS ACTIVAS' : 'VENTAS CERRADAS';
  let offset = 0;
  for (let p = 0; p < layout.count; p++) {
    const d: Drawing[] = []; background(d); heading(d, `SORTEO · ${state}`);
    const count = Math.min(p === 0 ? layout.first : layout.continuation, s.quantity - offset);
    if (!p) {
      box(d, 72, 565, 936, 238, c.light, 22);
      const prizes = s.prizes.map((v, i) => `${i + 1}. ${v.description}`).join('  ·  ');
      lines(d, shortened(wrapText(prizes, 36, 880, measure, true), 2, 36, 880, measure), 96, 600, 36, true);
      const date = s.drawAt ? new Date(s.drawAt).toLocaleString('es-AR') : 'Fecha a confirmar';
      text(d, date, 96, 710, 30);
      text(d, 'Premios y reglas completos en las bases adjuntas.', 96, 758, 28);
    }
    const startY = p === 0 ? 875 : 620; const gap = 12; const cellW = (936 - (layout.columns - 1) * gap) / layout.columns;
    const values: number[] = [];
    text(d, `Números ${s.start + offset} al ${s.start + offset + (count - 1)}`, 72, startY - 56, 32, true);
    for (let i = 0; i < count; i++) {
      const value = s.start + offset + i; values.push(value); const status = states.get(value) ?? 'disponible';
      const x = 72 + (i % layout.columns) * (cellW + gap); const y = startY + Math.floor(i / layout.columns) * 88;
      const available = s.template === 'minimalista' ? c.bg : s.template === 'elegante' ? c.light : s.template === 'colorida' && i % 2 ? c.light : '#ffffff';
      const radius = s.template === 'minimalista' ? 0 : s.template === 'elegante' ? 18 : s.template === 'colorida' ? 28 : 10;
      box(d, x, y, cellW, 76, status === 'vendido' ? c.ink : status === 'reservado' ? '#f8e3b5' : available, radius);
      const label = `${value} ${status === 'vendido' ? '✓' : status === 'reservado' ? 'R' : '○'}`;
      const size = 38;
      text(d, label, x + (cellW - measure(label, size, true)) / 2, y + 13, size, true, status === 'vendido' ? '#ffffff' : c.ink);
    }
    text(d, ['ventas_cerradas','sorteado','archivado'].includes(s.status) ? '○ No vendido    ✓ Vendido' : '○ Libre    R Reservado    ✓ Vendido', 72, 1740, 32, true);
    text(d, `Grilla · Parte ${p + 1} de ${layout.count} · Ref. ${s.id.slice(0, 8)}`, 72, 1800, 28);
    pages.push({ kind: 'grid', title: `Grilla ${p + 1} de ${layout.count} · ${values[0]} al ${values.at(-1)}`, drawings: d, values });
    offset += count;
  }
  const photographed = s.prizes.map((prize, index) => ({ ...prize, index })).filter(prize => prize.image);
  for (let start = 0; start < photographed.length; start += 4) {
    const group = photographed.slice(start, start + 4); const d: Drawing[] = []; background(d); heading(d, 'PREMIOS');
    group.forEach((prize, index) => {
      const column = index % 2; const row = Math.floor(index / 2); const x = 72 + column * 480; const y = 570 + row * 550;
      box(d, x, y, 456, 500, s.template === 'elegante' || s.template === 'colorida' ? c.light : '#ffffff', s.template === 'minimalista' ? 0 : 22);
      d.push({ type: 'image', source: prize.image!, x: x + 28, y: y + 28, w: 400, h: 340 });
      lines(d, shortened(wrapText(`${prize.index + 1}. ${prize.description}`, 32, 400, measure, true), 3, 32, 400, measure), x + 28, y + 390, 32, true);
    });
    text(d, `Premios · Parte ${Math.floor(start / 4) + 1} de ${Math.ceil(photographed.length / 4)}`, 72, 1740, 32, true);
    text(d, `Ref. ${s.id.slice(0, 8)}`, 72, 1800, 28);
    pages.push({ kind: 'conditions', title: `Fotos de premios ${Math.floor(start / 4) + 1} de ${Math.ceil(photographed.length / 4)}`, drawings: d, values: [] });
  }
  type ConditionRow = { kind: 'heading' | 'body'; value: string; height: number };
  const blocks = publicConditionSections(s).map(section => {
    const rows: ConditionRow[] = wrapText(section.title, 28, 900, measure, true).map(value => ({ kind: 'heading', value, height: 42 }));
    for (const paragraph of section.paragraphs) {
      rows.push(...wrapText(paragraph, 32, 912, measure).map(value => ({ kind: 'body' as const, value, height: 42 })));
      rows.push({ kind: 'body', value: '', height: 14 });
    }
    rows.push({ kind: 'body', value: '', height: 16 });
    return rows;
  });
  const conditionPages: ConditionRow[][] = [[]]; const pageHeight = 1190;
  let used = 0;
  for (const block of blocks) {
    const blockHeight = block.reduce((sum, row) => sum + row.height, 0);
    if (used && blockHeight <= pageHeight && used + blockHeight > pageHeight) { conditionPages.push([]); used = 0; }
    for (const row of block) {
      if (used && used + row.height > pageHeight) { conditionPages.push([]); used = 0; }
      conditionPages.at(-1)!.push(row); used += row.height;
    }
  }
  const total = conditionPages.length;
  if (pages.length + total > MAX_GRAPHIC_PAGES) throw new Error('Las bases y la grilla exceden 100 imágenes. Acortá los textos o usá un sorteo más pequeño.');
  for (let p = 0; p < total; p++) {
    const d: Drawing[] = []; background(d);
    if (s.image) d.push({ type: 'image', source: s.image, x: 850, y: 70, w: 138, h: 110 });
    text(d, 'BASES Y CONDICIONES', 72, 160, 36, true);
    lines(d, shortened(wrapText(s.name, 38, s.image ? 700 : 936, measure, true), 2, 38, s.image ? 700 : 936, measure), 72, 215, 38, true);
    text(d, `Ref. ${s.id.slice(0, 8)} · ${state}`, 72, 300, 26);
    let y = 380;
    for (const row of conditionPages[p]!) {
      if (row.value) {
        if (row.kind === 'heading') { box(d, 72, y + 3, 8, 28, c.accent, 4); text(d, row.value, 96, y, 28, true); }
        else text(d, row.value, 96, y, 32);
      }
      y += row.height;
    }
    text(d, `Bases · Parte ${p + 1} de ${total}`, 72, 1740, 32, true);
    text(d, 'Revisá todas las piezas antes de participar.', 72, 1800, 28);
    pages.push({ kind: 'conditions', title: `Bases y condiciones ${p + 1} de ${total}`, drawings: d, values: [] });
  }
  return pages;
}

export async function renderGraphics(s: PublicRaffle, onProgress: (done: number, total: number) => void): Promise<GraphicImage[]> {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo iniciar el generador de imágenes.');
  const font = (size: number, bold = false) => `${bold ? '700' : '400'} ${size}px Arial, sans-serif`;
  const measure: Measure = (text, size, bold) => { ctx.font = font(size, bold); return ctx.measureText(text).width; };
  const pages = planGraphics(s, measure);
  const sources = new Set(pages.flatMap(page => page.drawings.filter((drawing): drawing is Extract<Drawing, { type: 'image' }> => drawing.type === 'image').map(drawing => drawing.source)));
  const loaded = new Map<string, HTMLImageElement>();
  for (const source of sources) { const image = new Image(); image.src = source; await image.decode(); loaded.set(source, image); }
  const images: GraphicImage[] = []; let bytes = 0;
  try {
    for (const [i, p] of pages.entries()) {
      ctx.clearRect(0, 0, 1080, 1920); ctx.textBaseline = 'top';
      for (const d of p.drawings) {
        if (d.type === 'box') { ctx.fillStyle = d.color; ctx.beginPath(); ctx.roundRect(d.x, d.y, d.w, d.h, d.radius ?? 0); ctx.fill(); }
        else if (d.type === 'text') { ctx.font = font(d.size, d.bold); ctx.fillStyle = d.color; ctx.fillText(d.text, d.x, d.y); }
        else { const image = loaded.get(d.source)!; const scale = Math.min(d.w / image.width, d.h / image.height); const w = image.width * scale; const h = image.height * scale; ctx.drawImage(image, d.x + (d.w - w) / 2, d.y + (d.h - h) / 2, w, h); }
      }
      const dataUrl = canvas.toDataURL('image/png'); bytes += dataUrl.length;
      if (bytes > MAX_GRAPHIC_BYTES) throw new Error('Las imágenes exceden 60 MB. Probá quitar el logo o alguna foto de premio.');
      images.push({ kind: p.kind, title: p.title, dataUrl }); onProgress(i + 1, pages.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { canvas.width = 0; canvas.height = 0; }
  return images;
}
