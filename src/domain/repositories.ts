import type { Raffle } from './models';

export interface RaffleRepository {
  list(): Promise<Raffle[]>;
  findById(id: string): Promise<Raffle | null>;
}
