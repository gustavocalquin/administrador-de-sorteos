import { money, type Palette, type Template } from './catalog';
import type { NumberStatus, Raffle } from './models';

/** Public allowlist: never pass a Buyer or an operational snapshot to the renderer. */
export interface PublicRaffle {
  id: string; revision: number; name: string; description: string; contact: string;
  start: number; quantity: number; price: number; drawAt: string | null; method: string;
  participants: Raffle['participants']; unsoldRule: string | null; status: Raffle['status'];
  prizes: { description: string; image: string | null }[]; template: Template; palette: Palette; image: string | null;
  notes: string; numbers: { value: number; status: NumberStatus }[];
}
export interface GraphicImage { kind: 'grid' | 'conditions'; title: string; dataUrl: string }
export interface GraphicSet { id: string; revision: number; generatedAt: string; images: GraphicImage[] }
export interface PublicConditionSection { title: string; paragraphs: string[] }
export const MAX_GRAPHIC_PAGES = 100;
export const MAX_GRAPHIC_BYTES = 60_000_000; // Encoded payload, bounded in JS and native bridge.
export function publicConditionSections(s: PublicRaffle): PublicConditionSection[] {
  const sections: PublicConditionSection[] = [
    { title: '1 · Organizador y contacto', paragraphs: [s.contact] },
    { title: '2 · Numeración y precio', paragraphs: [
      `Se ofrecen ${s.quantity} números, desde el ${s.start} hasta el ${s.start + (s.quantity - 1)}.`,
      `Precio por número: ${money(s.price)}.`,
    ] },
    { title: '3 · Premios', paragraphs: s.prizes.map((p, i) => `Premio ${i + 1}: ${p.description}`) },
    { title: '4 · Fecha, método y lugar', paragraphs: [
      s.drawAt ? `Fecha prevista: ${new Date(s.drawAt).toLocaleString('es-AR')}.` : 'Fecha prevista: a confirmar.',
      s.method,
    ] },
    { title: '5 · Participación', paragraphs: [s.participants === 'todos'
      ? `Participan todos los números. Si se extrae un número sin comprador: ${s.unsoldRule}`
      : 'Participan únicamente los números vendidos y pagados.'] },
    { title: '6 · Reservas y resultados', paragraphs: [
      'Una reserva que no fue pagada no participa ni otorga derecho a reclamar un premio.',
      'Cada número puede obtener como máximo un premio. El resultado se registra de acuerdo con la extracción externa indicada en estas bases.',
    ] },
  ];
  if (s.description.trim()) sections.splice(1, 0, { title: 'Descripción', paragraphs: [s.description] });
  if (s.notes.trim()) sections.push({ title: 'Aclaraciones adicionales', paragraphs: s.notes.split(/\r?\n/).filter(Boolean) });
  return sections;
}
export function publicConditions(s: PublicRaffle): string[] {
  return [`Sorteo: ${s.name}`, ...publicConditionSections(s).flatMap(section => [section.title, ...section.paragraphs])];
}
export function gridLayout(s: Pick<PublicRaffle, 'start' | 'quantity'>) {
  const digits = Math.max(String(s.start).length, String(s.start + (s.quantity - 1)).length);
  const columns = digits <= 4 ? 5 : digits <= 7 ? 3 : digits <= 11 ? 2 : 1;
  const first = columns * 8; const continuation = columns * 12;
  const count = 1 + Math.ceil(Math.max(0, s.quantity - first) / continuation);
  if (count >= MAX_GRAPHIC_PAGES) throw new Error('Este rango requiere demasiadas imágenes. El límite actual es 100 piezas por generación; no se recortará la grilla.');
  return { columns, first, continuation, count };
}
export function validateImages(images: GraphicImage[]): void {
  if (!images.length || images.length > MAX_GRAPHIC_PAGES || !images.some(p => p.kind === 'grid') || !images.some(p => p.kind === 'conditions')) throw new Error('El conjunto de imágenes está incompleto o excede 100 piezas.');
  let size = 0; let conditions = false;
  for (const p of images) {
    if (p.kind === 'conditions') conditions = true;
    else if (p.kind !== 'grid' || conditions) throw new Error('El orden de las piezas es inválido.');
    if (!p.title || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+=*$/.test(p.dataUrl)) throw new Error('Se esperaba una imagen PNG válida.');
    size += p.dataUrl.length;
  }
  if (size > MAX_GRAPHIC_BYTES) throw new Error('Las imágenes exceden el límite de memoria (60 MB). Probá quitar la foto original.');
}
