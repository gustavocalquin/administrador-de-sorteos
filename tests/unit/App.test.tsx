// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';

let db: Database;
let service: CatalogService;
beforeEach(async () => {
  localStorage.clear(); delete document.documentElement.dataset.theme;
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver);
  service = new CatalogService(db, 'preview');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});
afterEach(async () => { cleanup(); await db.close(); vi.restoreAllMocks(); });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
async function start() { render(<App load={async () => service} />); await screen.findByText('Todo empieza con un sorteo'); }
async function seedRaffle(name = 'Rifa de prueba') {
  const value = newRaffle();
  Object.assign(value.raffle, { name, publicContact: 'Club', drawMethod: 'Presencial', quantity: 10, unitPriceCents: 10000 });
  value.prizes[0]!.description = 'Premio';
  return service.saveRaffle(value);
}
async function startWithRaffle(name = 'Rifa de prueba') {
  const saved = await seedRaffle(name);
  render(<App load={async () => service} />);
  await screen.findByRole('heading', { name: 'Mis sorteos' });
  return saved;
}

it('presenta inicio vacío, CTA y aviso honesto de la prueba web', async () => {
  await start();
  expect(screen.getByRole('heading', { name: 'Mis sorteos' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Crear mi primer sorteo' })).toBeVisible();
  expect(screen.getByText('Prueba web · Los datos se pierden al recargar')).toBeVisible();
});
it('un fallo permite reintentar sin simular datos vacíos', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('storage failure')).mockResolvedValueOnce(service);
  render(<App load={load} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos abrir tus datos');
  expect(screen.queryByText('Todo empieza con un sorteo')).not.toBeInTheDocument();
  click('Reintentar'); expect(await screen.findByText('Todo empieza con un sorteo')).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});
it('crea con asistente y cambios de modo, conserva premios y edita la misma ficha', async () => {
  await start(); click('Crear mi primer sorteo');
  change('Nombre del sorteo', 'Rifa del club'); change('Organizador y contacto público', 'Club · 111234'); click('Continuar');
  change('Número inicial', '10'); change('Cantidad', '50'); change('Precio por número (ARS)', '1500,50');
  change('Premio 1', 'Bicicleta'); click('+ Agregar premio'); change('Premio 2', 'Canasta');
  expect(screen.getByLabelText('Foto del premio 1 (opcional)')).toBeVisible();
  click('Subir premio 2'); click('Modo avanzado');
  expect(screen.getByLabelText('Nombre del sorteo')).toHaveValue('Rifa del club');
  expect(screen.getByLabelText('Premio 1')).toHaveValue('Canasta');
  change('Método y lugar del sorteo', 'Extracción presencial en el club');
  change('Participan', 'todos'); change('Regla si sale un número sin comprador', 'Repetir la extracción externa hasta obtener un número vendido.');
  change('Plantilla', 'festiva'); click('Usar asistente');
  click('Continuar'); click('Continuar');
  expect(screen.getByLabelText('Logo del sorteo (opcional)')).toBeVisible();
  click('Guardar sorteo');
  expect(await screen.findByRole('heading', { name: 'Rifa del club' })).toBeVisible();
  let all = await service.listRaffles(); expect(all).toHaveLength(1);
  const id = all[0]!.id;
  let saved = await service.getRaffle(id);
  expect(saved.prizes.map(p => p.description)).toEqual(['Canasta', 'Bicicleta']);
  expect(saved.raffle.unitPriceCents).toBe(150050); expect(saved.template).toBe('festiva');
  click('Editar sorteo'); change('Nombre del sorteo', 'Rifa de primavera'); click('Modo avanzado'); click('Guardar sorteo');
  await screen.findByRole('heading', { name: 'Rifa de primavera' });
  all = await service.listRaffles(); expect(all).toHaveLength(1); expect(all[0]!.id).toBe(id);
  saved = await service.getRaffle(id); expect(saved.revision).toBe(2);
});
it('impide continuar con campos faltantes y guardar regla vacía o rango inválido', async () => {
  await start(); click('Crear mi primer sorteo'); click('Continuar');
  expect(screen.getByRole('alert')).toHaveTextContent('nombre y el contacto');
  change('Nombre del sorteo', 'Mi rifa'); change('Organizador y contacto público', 'Contacto'); click('Modo avanzado');
  change('Premio 1', 'Premio'); change('Método y lugar del sorteo', 'Presencial'); change('Participan', 'todos');
  click('Guardar sorteo'); expect(screen.getByRole('alert')).toHaveTextContent('regla');
  change('Regla si sale un número sin comprador', 'Vacante'); change('Cantidad', '0'); click('Guardar sorteo');
  expect(screen.getByRole('alert')).toHaveTextContent('cantidad positiva'); expect(await service.listRaffles()).toHaveLength(0);
});
it('protege cambios al navegar y permite conservar o descartar', async () => {
  await start(); click('Crear mi primer sorteo'); change('Nombre del sorteo', 'No perder'); click('Compradores');
  expect(screen.getByRole('dialog')).toBeVisible(); click('Seguir editando');
  expect(screen.getByLabelText('Nombre del sorteo')).toHaveValue('No perder'); click('Cancelar'); click('Descartar cambios');
  expect(screen.getByRole('heading', { name: 'Mis sorteos' })).toBeVisible(); expect(await service.listRaffles()).toHaveLength(0);
});
it('alta de compradores, teléfono compartido, selección sin duplicar, edición y búsqueda', async () => {
  await start(); click('Compradores'); click('+ Nuevo comprador');
  change('Teléfono', '+54 (11) 2222'); change('Nombre', 'Ana'); change('Apellido', 'Pérez'); click('Guardar comprador');
  await screen.findByText('Pérez, Ana'); click('+ Nuevo comprador'); change('Teléfono', '54112222');
  expect(screen.getByText('Ya hay compradores con este teléfono')).toBeVisible();
  change('Nombre', 'Luis'); change('Apellido', 'Pérez'); click('Guardar comprador'); await screen.findByText('Pérez, Luis');
  click('+ Nuevo comprador'); change('Teléfono', '54112222');
  fireEvent.click(screen.getByRole('button', { name: /Usar Ana Pérez/ })); click('Descartar cambios');
  expect(screen.getByLabelText('Nombre')).toHaveValue('Ana'); change('Apellido', 'Gómez'); click('Guardar comprador');
  await screen.findByText('Gómez, Ana'); change('Buscar comprador', ' GO MEZ aNA ');
  expect(screen.getByText('Gómez, Ana')).toBeVisible(); expect(screen.queryByText('Pérez, Luis')).not.toBeInTheDocument();
  expect(await service.listBuyers()).toHaveLength(2);
});
it('conserva formulario y muestra error si SQLite rechaza el guardado', async () => {
  await start(); click('Compradores'); click('+ Nuevo comprador');
  change('Teléfono', '123'); change('Nombre', 'Ana'); change('Apellido', 'Pérez');
  await db.read(tx => tx.execute("CREATE TRIGGER reject_buyer BEFORE INSERT ON buyers BEGIN SELECT RAISE(ABORT, 'Sin espacio de prueba'); END;"));
  click('Guardar comprador'); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sin espacio'));
  expect(screen.getByLabelText('Nombre')).toHaveValue('Ana'); expect(await service.listBuyers()).toHaveLength(0);
});
it('conserva fecha y hora al alternar modos y guarda el instante UTC correspondiente', async () => {
  await start(); click('Crear mi primer sorteo'); click('Modo avanzado');
  change('Nombre del sorteo', 'Con fecha'); change('Organizador y contacto público', 'Club');
  change('Premio 1', 'Premio'); change('Método y lugar del sorteo', 'Presencial');
  change('Fecha del sorteo', 'fecha'); change('Fecha y hora local', '2026-12-20T19:30');
  click('Usar asistente'); click('Modo avanzado');
  expect(screen.getByLabelText('Fecha y hora local')).toHaveValue('2026-12-20T19:30'); click('Guardar sorteo');
  await screen.findByRole('heading', { name: 'Con fecha' });
  expect((await service.listRaffles())[0]!.drawAt).toBe(new Date('2026-12-20T19:30').toISOString());
  click('Editar sorteo'); click('Modo avanzado');
  expect(screen.getByLabelText('Fecha y hora local')).toHaveValue('2026-12-20T19:30');
});

it('muestra activar como acción principal junto a compartir y actualiza el estado', async () => {
  const saved = await startWithRaffle('Rifa para activar');
  click('Abrir Rifa para activar');
  const activate = await screen.findByRole('button', { name: 'Activar sorteo' });
  const actions = activate.closest('.primary-actions') as HTMLElement;
  expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Activar sorteo', 'Compartir sorteo']);
  fireEvent.click(activate as HTMLElement);
  await waitFor(async () => expect((await service.getRaffle(saved.raffle.id)).raffle.status).toBe('activo'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Activar sorteo' })).not.toBeInTheDocument());
});

it('abre acciones con pulsación prolongada y borra sin eliminar compradores', async () => {
  await service.saveBuyer({ phone: '110001', firstName: 'Ana', lastName: 'Prueba', email: null, notes: '' });
  await startWithRaffle('Rifa descartable');
  const card = screen.getByRole('listitem');
  vi.useFakeTimers();
  fireEvent.pointerDown(card, { button: 0, clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(651));
  fireEvent.pointerUp(card);
  vi.useRealTimers();
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Archivar' })).toBeDisabled();
  expect(dialog).toHaveTextContent('cuando estén completos todos los resultados');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar' }));
  dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Esta eliminación no se puede deshacer');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  expect(await service.listRaffles()).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Opciones de Rifa descartable' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Borrar' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Borrar' }));
  await screen.findByText('Todo empieza con un sorteo');
  expect(await service.listRaffles()).toHaveLength(0);
  expect(await service.listBuyers()).toHaveLength(1);
});

it('aplica y conserva el tema elegido sin cambiar las imágenes del sorteo', async () => {
  await start(); click('Ajustes');
  fireEvent.change(screen.getByLabelText('Tema'), { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByText('Las imágenes para compartir conservan la plantilla y la paleta elegidas.')).toBeVisible();
  cleanup(); render(<App load={async () => service} />); await screen.findByRole('heading', { name: 'Mis sorteos' });
  expect(document.documentElement.dataset.theme).toBe('dark');
});
