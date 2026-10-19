// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { RaffleBoard } from '../../src/ui/RaffleBoard';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';

let db: Database; let service: CatalogService; let id: string; let revision: number;
const back = createRef<(() => boolean) | null>();
beforeEach(async () => {
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver); service = new CatalogService(db, 'preview');
  const input = newRaffle(); Object.assign(input.raffle, { name: 'Rifa', publicContact: 'Club', drawMethod: 'Presencial', quantity: 105, unitPriceCents: 10000 });
  input.prizes[0]!.description = 'Bicicleta'; const saved = await service.saveRaffle(input);
  const active = await service.setSalesState(saved.raffle.id, saved.revision, 'activo'); id = active.raffle.id; revision = active.revision;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});
afterEach(async () => { cleanup(); await db.close(); vi.restoreAllMocks(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function start() {
  render(<RaffleBoard raffleId={id} revision={revision} service={service} backRef={back} onDirty={vi.fn()} onBusy={vi.fn()} onChanged={vi.fn()} onActivated={vi.fn()} />);
  await screen.findByRole('button', { name: 'Número 0, Disponible' });
}
function person() { change('Teléfono', '111234'); change('Nombre', 'Ana'); change('Apellido', 'Prueba'); }

it('reserva tres números y cobra uno desde el panel conservando los restantes', async () => {
  await start(); click('Selección múltiple');
  for (const n of [1, 2, 3]) click(`Número ${n}, Disponible`);
  click('Operar selección'); expect(screen.getByRole('dialog')).toHaveTextContent('3 números elegidos'); click('Reservar');
  expect(within(screen.getByRole('dialog')).getAllByRole('textbox').map(el => el.closest('label')!.textContent)).toEqual(['Teléfono', 'Nombre', 'Apellido']);
  person(); click('Confirmar reserva'); await screen.findByRole('button', { name: 'Número 1, Reservado' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); click('Número 1, Reservado'); click('Confirmar pago');
  await screen.findByRole('button', { name: 'Confirmar pago de 1 número' });
  expect(screen.getAllByRole('checkbox')).toHaveLength(3); click('Confirmar pago de 1 número');
  await screen.findByRole('button', { name: 'Número 1, Vendido' });
  expect(screen.getByRole('button', { name: 'Número 2, Reservado' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Número 3, Reservado' })).toBeVisible();
  expect((await service.operations.board(id)).collectedCents).toBe(10000);
  click('Selección múltiple'); expect(screen.getByRole('button', { name: 'Número 1, Vendido' })).toBeDisabled();
});

it('vende con ficha de teléfono compartido y exige advertencia y motivo al limpiar', async () => {
  for (const firstName of ['Ana', 'Luis']) await service.saveBuyer({ phone: '111234', firstName, lastName: 'Prueba', email: null, notes: '' });
  await start(); click('Número 4, Disponible'); click('Vender'); change('Teléfono', '111234');
  expect(screen.getByRole('button', { name: /Usar Ana Prueba/ })).toBeVisible(); click(/Usar Luis Prueba/); click('Confirmar venta');
  await screen.findByRole('button', { name: 'Número 4, Vendido' }); expect(await service.listBuyers()).toHaveLength(2);
  click('Número 4, Vendido'); click('Limpiar número'); expect(screen.getByRole('button', { name: 'Confirmar limpieza' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Revisé la posible devolución de dinero')); click('Confirmar limpieza');
  expect(await screen.findByRole('alert')).toHaveTextContent('motivo'); change('Motivo de la limpieza', 'Venta anulada por el comprador'); click('Confirmar limpieza');
  await screen.findByRole('button', { name: 'Número 4, Disponible' }); click('Número 4, Disponible'); click('Historial del número');
  expect(await screen.findByText('Motivo: Venta anulada por el comprador')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent('Luis Prueba'); expect((await service.operations.board(id)).collectedCents).toBe(0);
});

it('localiza fuera de la primera página y protege el formulario al cerrar', async () => {
  await start(); change('Ir al número', '103'); click('Ir');
  await screen.findByRole('dialog', { name: 'Número 103' });
  expect(await screen.findByRole('button', { name: 'Número 103, Disponible' })).toHaveClass('highlight');
  click('Reservar'); person(); click('Cerrar panel'); expect(screen.getByText('Hay cambios sin guardar')).toBeVisible();
  click('Seguir editando'); expect(screen.getByLabelText('Nombre')).toHaveValue('Ana'); click('Cerrar panel'); click('Descartar cambios');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(await service.listBuyers()).toHaveLength(0);
});

it('conserva datos si falla SQLite y permite reintentar sin duplicar', async () => {
  await start(); click('Número 7, Disponible'); click('Vender'); person();
  await db.read(tx => tx.execute("CREATE TRIGGER reject_item BEFORE INSERT ON operation_items BEGIN SELECT RAISE(ABORT,'Sin espacio de prueba'); END;"));
  click('Confirmar venta'); expect(await screen.findByRole('alert')).toHaveTextContent('Sin espacio');
  expect(screen.getByLabelText('Nombre')).toHaveValue('Ana'); expect(await service.listBuyers()).toHaveLength(0);
  await db.read(tx => tx.execute('DROP TRIGGER reject_item;')); click('Confirmar venta');
  await screen.findByRole('button', { name: 'Número 7, Vendido' }); expect(await service.listBuyers()).toHaveLength(1);
});

it('corrige comprador de un número vendido con motivo y conserva el cobro', async () => {
  await start(); click('Número 8, Disponible'); click('Vender'); person(); click('Confirmar venta');
  await screen.findByRole('button', { name: 'Número 8, Vendido' }); click('Número 8, Vendido'); click('Corregir comprador');
  change('Teléfono', '119876'); change('Nombre', 'Luis'); change('Apellido', 'Prueba'); change('Motivo de la corrección', 'Se eligió otra persona por error'); click('Guardar corrección');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Número 8, Vendido' })).toBeEnabled());
  click('Número 8, Vendido'); expect(screen.getByRole('dialog')).toHaveTextContent('Luis Prueba'); click('Historial del número');
  expect(await screen.findByText('Motivo: Se eligió otra persona por error')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent('Ana Prueba'); expect((await service.operations.board(id)).collectedCents).toBe(10000);
});
