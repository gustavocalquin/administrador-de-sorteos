import { validateRaffle, type Buyer, type Prize, type Raffle } from './models';

export const templates = ['clasica', 'moderna', 'festiva', 'minimalista', 'elegante', 'colorida'] as const;
export type Template = typeof templates[number];
export type Palette = 'bosque' | 'oceano' | 'ciruela';
export interface RaffleDetails {
  raffle: Raffle;
  prizes: Prize[];
  template: Template;
  palette: Palette;
  image: string | null;
  revision: number;
  locked: boolean;
}
export interface BuyerRecord extends Buyer { revision: number; assignedNumbers: number[] }
export type BuyerInput = Pick<Buyer, 'phone' | 'firstName' | 'lastName' | 'email' | 'notes'>;

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/\s/g, '');
}
export function normalizePhone(value: string): string { return value.replace(/\D/g, ''); }
export function searchBuyers(buyers: BuyerRecord[], query: string): BuyerRecord[] {
  const key = normalizeSearch(query);
  const phone = normalizePhone(query);
  const phoneQuery = /^[+\d\s().-]+$/.test(query);
  return buyers.filter(buyer => !key || normalizeSearch(`${buyer.firstName}${buyer.lastName}`).includes(key) ||
    normalizeSearch(`${buyer.lastName}${buyer.firstName}`).includes(key) ||
    (phoneQuery && phone && buyer.phoneKey.includes(phone)) || buyer.assignedNumbers.some(n => String(n) === key))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es', { sensitivity: 'base' }) ||
      a.firstName.localeCompare(b.firstName, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
export function validateBuyer(input: BuyerInput): BuyerInput {
  const clean = { phone: input.phone.trim(), firstName: input.firstName.trim(), lastName: input.lastName.trim(),
    email: input.email?.trim() || null, notes: input.notes.trim() };
  if (!clean.phone || !normalizePhone(clean.phone)) throw new Error('Ingresá un teléfono con números.');
  if (!clean.firstName || !clean.lastName) throw new Error('Nombre y apellido son obligatorios.');
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw new Error('Revisá el correo electrónico.');
  return clean;
}
export function validateDetails(value: RaffleDetails): void {
  validateRaffle(value.raffle);
  if (!value.raffle.publicContact.trim()) throw new Error('Ingresá el organizador y contacto público.');
  if (!value.raffle.drawMethod.trim()) throw new Error('Indicá el método y lugar del sorteo.');
  if (value.raffle.drawAt !== null && !Number.isFinite(Date.parse(value.raffle.drawAt))) throw new Error('Revisá la fecha del sorteo.');
  if (!['todos', 'solo_vendidos'].includes(value.raffle.participants)) throw new Error('Modalidad inválida.');
  if (value.raffle.participants === 'todos' && !value.raffle.unsoldRule?.trim())
    throw new Error('Escribí qué ocurre si sale un número sin comprador.');
  if (!value.prizes.length || value.prizes.some(p => !p.description.trim())) throw new Error('Ingresá al menos un premio y completá sus descripciones.');
  if (new Set(value.prizes.map(p => p.id)).size !== value.prizes.length) throw new Error('Hay premios duplicados.');
  if (!templates.includes(value.template) || !['bosque', 'oceano', 'ciruela'].includes(value.palette))
    throw new Error('Presentación inválida.');
  if (value.image !== null && (value.image.length > 2_800_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.image)))
    throw new Error('Usá un logo PNG, JPG o WebP de hasta 2 MB.');
  if (value.prizes.some(p => p.image != null && (p.image.length > 2_800_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(p.image))))
    throw new Error('Usá fotos de premios PNG, JPG o WebP de hasta 2 MB cada una.');
}
export function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value.trim())) throw new Error('Ingresá números enteros, sin puntos ni comas.');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('El número es demasiado grande.');
  return result;
}
export function parsePrice(value: string): number {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Ingresá el precio sin separador de miles y con hasta dos decimales.');
  const [whole, decimals = ''] = value.trim().replace(',', '.').split('.');
  const result = BigInt(whole!) * 100n + BigInt(decimals.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('El precio es demasiado grande.');
  return Number(result);
}
export function priceInput(cents: number): string {
  return `${BigInt(cents) / 100n},${String(BigInt(cents) % 100n).padStart(2, '0')}`;
}
export const money = (cents: number): string => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
  .formatToParts(BigInt(cents) / 100n).map(part => part.type === 'fraction' ? String(BigInt(cents) % 100n).padStart(2, '0') : part.value).join('');

export function newRaffle(): RaffleDetails {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return { raffle: { id, name: '', description: '', publicContact: '', startNumber: 0, quantity: 100,
    unitPriceCents: 0, currency: 'ARS', drawAt: null, drawMethod: '', participants: 'solo_vendidos', unsoldRule: null,
    status: 'borrador', createdAt: now, updatedAt: now },
  prizes: [{ id: crypto.randomUUID(), raffleId: id, position: 1, description: '', image: null }],
  template: 'clasica', palette: 'bosque', image: null, revision: 0, locked: false };
}
