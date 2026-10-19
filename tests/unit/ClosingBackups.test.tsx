// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';
import { RaffleClosing } from '../../src/ui/RaffleClosing';
import { Backups } from '../../src/ui/Backups';
import { exportBackupFile,importBackupFile } from '../../src/infrastructure/backup/files';
vi.mock('../../src/infrastructure/backup/files', () => ({nativeBackups:true,exportBackupFile:vi.fn(),importBackupFile:vi.fn()}));
let db: Database; let service: CatalogService; let id: string;
const password = 'frase-de-prueba-única';
const change = (label: string,value: string) => fireEvent.change(screen.getByLabelText(label),{target:{value}});
const click = (name: string) => fireEvent.click(screen.getByRole('button',{name}));
beforeEach(async () => {
  vi.stubGlobal('crypto',webcrypto);
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver); service = new CatalogService(db,'preview');
  const d = newRaffle(); Object.assign(d.raffle,{name:'Demo',publicContact:'Club',drawMethod:'Radio'}); d.prizes[0]!.description = 'Bicicleta';
  id = (await service.saveRaffle(d)).raffle.id; await service.setSalesState(id,1,'activo');
});
afterEach(async () => { cleanup(); await db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
it('exige confirmar cierre y permite revisar reservas antes de cancelar', async () => {
  const review = vi.fn(); const changed = vi.fn();
  render(<RaffleClosing raffleId={id} revision={2} reserved={0} sold={0} service={service} onDirty={vi.fn()} onBusy={vi.fn()} onChanged={changed} onReservations={review} />);
  expect(await screen.findByRole('button',{name:'Confirmar cierre de ventas'})).toBeDisabled();
  click('Revisar reservas'); expect(review).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('checkbox')); click('Confirmar cierre de ventas');
  await screen.findByText('Ventas cerradas. Las reservas impagas se cancelaron.'); expect(changed).toHaveBeenCalledOnce();
  expect((await service.getRaffle(id)).raffle.status).toBe('ventas_cerradas');
});
it('exportación cancelada no marca respaldo; exportación confirmada sí', async () => {
  vi.mocked(exportBackupFile).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<Backups service={service} onDirty={vi.fn()} onBusy={vi.fn()} onRestored={vi.fn()} />);
  change('Contraseña del nuevo respaldo',password); change('Repetir contraseña',password); click('Cifrar y elegir carpeta');
  await screen.findByText('Exportación cancelada. No se actualizó la fecha de respaldo.'); expect((await service.backups.status()).exportedAt).toBeNull();
  change('Contraseña del nuevo respaldo',password); change('Repetir contraseña',password); click('Cifrar y elegir carpeta');
  await screen.findByText('Respaldo cifrado exportado y verificado.'); expect((await service.backups.status()).exportedAt).not.toBeNull();
});
it('muestra vista previa sin reemplazar y exige confirmación escrita', async () => {
  const backup = await service.backups.create(password); await service.duplicateRaffle(id);
  vi.mocked(importBackupFile).mockResolvedValue(backup.file); const restored = vi.fn(async () => undefined);
  render(<Backups service={service} onDirty={vi.fn()} onBusy={vi.fn()} onRestored={restored} />);
  click('Elegir archivo cifrado'); await screen.findByText('Archivo seleccionado. Ingresá su contraseña para verificarlo.');
  change('Contraseña del archivo',password); click('Verificar y ver contenido');
  await screen.findByRole('heading',{name:'Respaldo verificado'}); expect(await service.listRaffles()).toHaveLength(2);
  expect(screen.getByRole('button',{name:'Reemplazar todos mis datos'})).toBeDisabled();
  change('Escribí REEMPLAZAR para confirmar','REEMPLAZAR'); click('Reemplazar todos mis datos');
  await waitFor(() => expect(restored).toHaveBeenCalledOnce()); expect(await service.listRaffles()).toHaveLength(1);
});
