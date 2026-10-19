export type UUID = string;
export type Instant = string;
export type RaffleStatus = 'borrador' | 'activo' | 'pausado' | 'ventas_cerradas' | 'sorteado' | 'archivado';
export type NumberStatus = 'disponible' | 'reservado' | 'vendido';

export interface Raffle {
  id: UUID;
  name: string;
  description: string;
  publicContact: string;
  startNumber: number;
  quantity: number;
  unitPriceCents: number;
  currency: 'ARS';
  drawAt: Instant | null;
  drawMethod: string;
  participants: 'todos' | 'solo_vendidos';
  unsoldRule: string | null;
  status: RaffleStatus;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface Buyer {
  id: UUID;
  phone: string;
  phoneKey: string;
  firstName: string;
  lastName: string;
  email: string | null;
  notes: string;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface Prize { id: UUID; raffleId: UUID; position: number; description: string; image?: string | null }
export interface RaffleNumber {
  id: UUID; raffleId: UUID; value: number; status: NumberStatus;
  buyerId: UUID | null; activeOperationId: UUID | null;
}
export interface Operation {
  id: UUID; raffleId: UUID; buyerId: UUID;
  type: 'reserva' | 'venta' | 'pago';
  status: 'vigente' | 'parcial' | 'completada' | 'anulada';
  amountCents: number; createdAt: Instant; updatedAt: Instant;
}
export interface OperationItem {
  operationId: UUID; numberId: UUID; raffleId: UUID; unitPriceCents: number;
  status: 'reservado' | 'pagado' | 'cancelado';
}
export interface Movement {
  id: UUID; entityType: string; entityId: UUID; action: string;
  beforeJson: string | null; afterJson: string | null; reason: string | null; createdAt: Instant;
}
// Contratos previstos; sus tablas y reglas se implementarán en sus etapas.
export interface SalesClosure { id: UUID; raffleId: UUID; closedAt: Instant; reopenedAt: Instant | null }
export interface ClosureParticipant {
  closureId: UUID; numberId: UUID; value: number; buyerId: UUID | null;
  buyerName: string | null; eligible: boolean;
}
export interface DrawResult {
  id: UUID; raffleId: UUID; prizeId: UUID; numberId: UUID; drawnValue: number;
  buyerId: UUID | null; method: string; recordedAt: Instant;
}
export interface GraphicConfiguration {
  raffleId: UUID; template: 'clasica' | 'moderna' | 'festiva' | 'minimalista' | 'elegante' | 'colorida'; palette: string;
  originalResourceId: UUID | null; generatedAt: Instant | null;
}

export function validateRaffle(raffle: Raffle): void {
  if (!raffle.name.trim()) throw new Error('El nombre es obligatorio.');
  if (!Number.isSafeInteger(raffle.startNumber) || !Number.isSafeInteger(raffle.quantity) || raffle.quantity < 1)
    throw new Error('El rango debe contener una cantidad positiva de números enteros válidos.');
  if (!Number.isSafeInteger(raffle.startNumber + (raffle.quantity - 1))) throw new Error('El rango es demasiado grande.');
  if (!Number.isSafeInteger(raffle.unitPriceCents) || raffle.unitPriceCents < 0 ||
      !Number.isSafeInteger(raffle.unitPriceCents * raffle.quantity)) throw new Error('El importe no es válido.');
}
