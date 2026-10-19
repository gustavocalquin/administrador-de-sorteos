import type { BuyerInput } from './catalog';
import type { NumberStatus, Raffle } from './models';

export interface NumberView {
  id: string | null; value: number; revision: number; status: NumberStatus;
  buyerId: string | null; buyerName: string | null; phone: string | null;
  operationId: string | null; unitPriceCents: number; assignedAt: string | null;
}
export interface NumberToken { value: number; revision: number }
export type BuyerChoice = { kind: 'existing'; id: string } | { kind: 'new'; input: BuyerInput };
export interface Board {
  raffle: Raffle; revision: number; offset: number; numbers: NumberView[];
  sold: number; reserved: number; available: number; collectedCents: number; imageDirty: boolean;
}
export interface HistoryEntry {
  id: string; sequence: number; action: string; beforeJson: string | null;
  afterJson: string | null; reason: string | null; createdAt: string;
}
export const PAGE_SIZE = 100;
export function validateSelection(selected: NumberToken[], raffle: Raffle): void {
  if (!selected.length) throw new Error('Elegí al menos un número.');
  if (new Set(selected.map(n => n.value)).size !== selected.length) throw new Error('La selección contiene números repetidos.');
  const end = raffle.startNumber + (raffle.quantity - 1);
  if (selected.some(n => !Number.isSafeInteger(n.value) || n.value < raffle.startNumber || n.value > end ||
    !Number.isSafeInteger(n.revision) || n.revision < 0)) throw new Error('La selección contiene números inválidos.');
}
export const numberStateLabel = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' } as const;
