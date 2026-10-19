export const unsoldRules = {
  vacant: 'El premio queda vacante si sale un número sin comprador.',
  repeat: 'Repetir la extracción externa hasta obtener un número vendido.',
} as const;
export type UnsoldPolicy = keyof typeof unsoldRules;
export function unsoldPolicy(text: string | null): UnsoldPolicy | null {
  return text === unsoldRules.vacant ? 'vacant' : text === unsoldRules.repeat ? 'repeat' : null;
}
export interface FrozenBuyer { id: string; firstName: string; lastName: string; phone: string }
export interface ClosureSnapshot {
  start: number; quantity: number; participants: 'todos' | 'solo_vendidos';
  unsoldRule: string | null; method: string;
  sold: { value: number; buyer: FrozenBuyer }[];
}
export interface Closure { id: string; closedAt: string; snapshot: ClosureSnapshot }
export interface DrawResult { prizeId: string; number: number; buyer: FrozenBuyer | null; recordedAt: string }
export interface ClosingView {
  closure: Closure | null; results: DrawResult[]; hasDraws: boolean;
  draws: { number: number; outcome: string; reason: string | null; recordedAt: string; prizeId: string }[];
}
