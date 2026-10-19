// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import type { GraphicImage } from '../../src/domain/graphics';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';
import { RaffleImages } from '../../src/ui/RaffleImages';

let db: Database; let service: CatalogService; let id: string;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Y7sAAAAASUVORK5CYII=';
const images: GraphicImage[] = [{ kind: 'grid', title: 'Grilla 1', dataUrl: png }, { kind: 'grid', title: 'Grilla 2', dataUrl: png }, { kind: 'conditions', title: 'Bases', dataUrl: png }];
const renderer = vi.fn(async () => images); const send = vi.fn(async () => 'Selector abierto');
beforeEach(async () => {
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver); service = new CatalogService(db, 'preview');
  const d = newRaffle(); Object.assign(d.raffle, { name: 'Rifa', publicContact: 'Club', drawMethod: 'Presencial' }); d.prizes[0]!.description = 'Bicicleta'; id = (await service.saveRaffle(d)).raffle.id;
  renderer.mockClear(); send.mockClear();
});
afterEach(async () => { cleanup(); await db.close(); vi.restoreAllMocks(); });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
async function start() {
  render(<RaffleImages raffleId={id} service={service} onDirty={vi.fn()} onBusy={vi.fn()} onChanged={vi.fn()} render={renderer} send={send} />);
  await screen.findByRole('button', { name: 'Generar nueva imagen' });
}
async function generate() { click('Generar nueva imagen'); await screen.findByRole('button', { name: 'Compartir selección (3)' }); }

it('no genera automáticamente; selecciona todas por defecto y comparte solo lo elegido en orden', async () => {
  await start(); expect(renderer).not.toHaveBeenCalled(); await generate(); expect(screen.getAllByRole('checkbox').every(el => (el as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByLabelText('Grilla 1')); click('Compartir selección (2)'); await screen.findByText('Selector abierto');
  expect(send).toHaveBeenCalledWith([images[1], images[2]], 'share');
  click('Desmarcar todas'); expect(screen.getByRole('button', { name: 'Compartir selección (0)' })).toBeDisabled();
  click('Seleccionar todas'); expect(screen.getByRole('button', { name: 'Compartir selección (3)' })).toBeEnabled();
});

it('comprueba vigencia nuevamente al compartir y no llama al selector con imágenes antiguas', async () => {
  await start(); await generate();
  const d = await service.getRaffle(id); await service.setSalesState(id, d.revision, 'activo');
  click('Compartir selección (3)'); expect(await screen.findByRole('alert')).toHaveTextContent('desactualizada'); expect(send).not.toHaveBeenCalled();
});

it('guarda aclaraciones antes de generar y conserva imágenes anteriores si falla el render', async () => {
  await start(); await generate(); const previous = await service.graphics.get(id);
  fireEvent.change(screen.getByLabelText('Aclaraciones para las bases'), { target: { value: 'Consultar horarios al club.' } });
  expect(screen.getByRole('button', { name: 'Compartir selección (3)' })).toBeDisabled();
  renderer.mockRejectedValueOnce(new Error('No hay memoria de prueba')); click('Generar nueva imagen');
  expect(await screen.findByRole('alert')).toHaveTextContent('No hay memoria');
  expect((await service.graphics.snapshot(id)).notes).toBe('Consultar horarios al club.');
  expect((await service.graphics.get(id))!.id).toBe(previous!.id);
  expect(screen.getByRole('button', { name: 'Compartir selección (3)' })).toBeDisabled();
});

it('protege doble generación mientras está preparando las piezas', async () => {
  let finish!: (value: GraphicImage[]) => void;
  renderer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await start(); click('Generar nueva imagen'); click('Generar nueva imagen');
  await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1)); expect(screen.getByRole('button', { name: 'Generar nueva imagen' })).toBeDisabled();
  finish(images); await screen.findByRole('button', { name: 'Compartir selección (3)' });
});

it('deshabilita compartir al recibir una revisión nueva mientras la vista permanece abierta', async () => {
  const initial = await service.graphics.snapshot(id);
  const props = { raffleId: id, service, onDirty: vi.fn(), onBusy: vi.fn(), onChanged: vi.fn(), render: renderer, send };
  const view = render(<RaffleImages {...props} revision={initial.revision} />);
  await screen.findByRole('button', { name: 'Generar nueva imagen' }); await generate();
  view.rerender(<RaffleImages {...props} revision={initial.revision + 1} />);
  expect(screen.getByRole('button', { name: 'Compartir selección (3)' })).toBeDisabled();
  expect(screen.getByText('Imagen desactualizada. Generá una nueva para incluir los cambios.')).toBeVisible();
});
