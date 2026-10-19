import { useEffect, useRef, useState } from 'react';
import type { CatalogService } from '../application/catalog-service';
import type { BackupPreview } from '../application/backup-service';
import { exportBackupFile, importBackupFile, nativeBackups } from '../infrastructure/backup/files';
import { MAX_FILE_BYTES } from '../infrastructure/backup/crypto';

export function Backups({ service,onDirty,onBusy,onRestored }: { service: CatalogService; onDirty: (v: boolean) => void; onBusy: (v: boolean) => void; onRestored: () => Promise<void> }) {
  const [password,setPassword] = useState(''); const [repeat,setRepeat] = useState(''); const [unlock,setUnlock] = useState('');
  const [file,setFile] = useState<string | null>(null); const [preview,setPreview] = useState<BackupPreview | null>(null);
  const [confirmation,setConfirmation] = useState(''); const [busy,setBusy] = useState(false); const inFlight = useRef(false);
  const [message,setMessage] = useState(''); const [error,setError] = useState(''); const [refresh,setRefresh] = useState(0);
  const [status,setStatus] = useState<{ exportedAt: string | null; reminder: boolean; recoveryAt: string | null } | null>(null);
  useEffect(() => { let active = true; service.backups.status().then(s => { if (active) setStatus(s); }).catch(() => { if (active) setError('No se pudo consultar el estado de respaldos.'); }); return () => { active = false; }; },[service,refresh]);
  useEffect(() => { onDirty(!!password || !!repeat || !!unlock || !!file || !!preview); return () => onDirty(false); },[password,repeat,unlock,file,preview,onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); },[busy,onBusy]);
  useEffect(() => () => service.backups.discardPreview(),[service]);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); setRefresh(n => n+1); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); inFlight.current = false; }
  }
  function discard() { service.backups.discardPreview(); setPreview(null); setConfirmation(''); setFile(null); setUnlock(''); }
  return <section className="form-card"><h2>Copias de seguridad</h2>
    <p>Incluyen todos los sorteos, compradores, historial, cierres, resultados e imágenes. La contraseña no se guarda y no hay recuperación si la olvidás.</p>
    <p className="hint">{status?.exportedAt ? `Última exportación verificada: ${new Date(status.exportedAt).toLocaleString('es-AR')}` : 'Todavía no hay una exportación externa verificada.'}</p>
    {status?.reminder && <p className="notice">Tenés cambios sin respaldar y pasó al menos una semana. Guardá una copia externa.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <fieldset disabled={busy}>
      {!preview && <>
        <form onSubmit={e => { e.preventDefault(); void run(async () => {
          if (password !== repeat) throw new Error('Las contraseñas no coinciden.');
          const backup = await service.backups.create(password);
          const saved = await exportBackupFile(backup.file);
          if (saved) { await service.backups.markExported(backup.fingerprint); setMessage('Respaldo cifrado exportado y verificado.'); }
          else setMessage(nativeBackups ? 'Exportación cancelada. No se actualizó la fecha de respaldo.' : 'Descarga cifrada iniciada. Comprobá que el navegador guardó el archivo; esta demo no puede verificarlo.');
          setPassword(''); setRepeat('');
        }); }}>
          <h3>Crear respaldo completo</h3><label>Contraseña del nuevo respaldo<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={1024} required /></label>
          <label>Repetir contraseña<input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required /></label>
          <p className="hint">Usá una frase larga y única de al menos 12 caracteres. Guardala en un lugar seguro.</p>
          <button type="submit">{busy ? 'Procesando…' : nativeBackups ? 'Cifrar y elegir carpeta' : 'Descargar respaldo de prueba'}</button>
        </form>
        <hr /><h3>Restaurar un respaldo</h3><p>Reemplaza todos los datos actuales. Primero se verifica el archivo y se muestra una vista previa.</p>
        {nativeBackups ? <button className="secondary" onClick={() => void run(async () => { setFile(await importBackupFile()); })}>Elegir archivo cifrado</button> :
          <label>Archivo cifrado de prueba<input type="file" accept=".sorteos,application/octet-stream" onChange={e => {
            const selected = e.target.files?.[0]; setFile(null); if (!selected) return;
            void run(async () => { if (selected.size > MAX_FILE_BYTES) throw new Error('El archivo supera 180 MB.'); setFile(await selected.text()); });
          }} /></label>}
        {file && <p>Archivo seleccionado. Ingresá su contraseña para verificarlo.</p>}
        <label>Contraseña del archivo<input type="password" autoComplete="off" value={unlock} onChange={e => setUnlock(e.target.value)} maxLength={1024} /></label>
        <button disabled={!file || !unlock} onClick={() => void run(async () => { setPreview(await service.backups.preview(file!,unlock)); setUnlock(''); setFile(null); })}>Verificar y ver contenido</button>
        {status?.recoveryAt && <details><summary>Resguardo interno anterior</summary><p>Previo al último reemplazo: {new Date(status.recoveryAt).toLocaleString('es-AR')}. Está en este dispositivo y no reemplaza una copia externa.</p>
          <button className="secondary" onClick={() => void run(async () => { setPreview(await service.backups.previewRecovery()); })}>Revisar resguardo interno</button></details>}
      </>}
      {preview && <section aria-label="Vista previa de restauración"><h3>Respaldo verificado</h3><p>Creado: {new Date(preview.createdAt).toLocaleString('es-AR')}</p>
        <p>{preview.raffles} sorteos · {preview.buyers} compradores · {preview.operations} operaciones · {preview.results} resultados · {preview.resources} recursos originales.</p>
        <p className="notice">Se reemplazarán TODOS los datos actuales. No se combinarán agendas ni sorteos. Antes se conservará un resguardo interno del estado actual.</p>
        <label>Escribí REEMPLAZAR para confirmar<input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        <div className="form-actions"><button disabled={confirmation !== 'REEMPLAZAR'} onClick={() => void run(async () => {
          await service.backups.restore(preview.token,confirmation); discard(); setPassword(''); setRepeat('');
          await onRestored(); setMessage('Restauración completa. El estado anterior quedó en el resguardo interno.');
        })}>Reemplazar todos mis datos</button><button className="secondary" onClick={discard}>Cancelar restauración</button></div>
      </section>}
    </fieldset>
  </section>;
}
