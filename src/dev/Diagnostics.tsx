import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { openNativeDatabase } from '../infrastructure/database/native';
import { checkRollback, readDiagnostic, writeDiagnostic } from './diagnostic-service';

export default function Diagnostics() {
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let active = true;
    openNativeDatabase('sorteos_diagnostico').then(readDiagnostic)
      .then(data => { if (active) setReport(JSON.stringify(data, null, 2)); })
      .catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);
  async function run(action: 'write' | 'read' | 'rollback') {
    setBusy(true); setError('');
    try {
      const db = await openNativeDatabase('sorteos_diagnostico');
      const message = action === 'rollback' ? await checkRollback(db) : undefined;
      const report = await (action === 'write' ? writeDiagnostic(db) : readDiagnostic(db));
      setReport(JSON.stringify({ ...report, message }, null, 2));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <section className="diagnostics"><h2>Prueba técnica · Etapa 1</h2>
    <p>Usa una base separada. Guardá una muestra, cerrá la app y volvé a abrirla: deben mantenerse el UUID y la fecha.</p>
    {Capacitor.getPlatform() !== 'android' ? <p>Esta prueba requiere la APK en Android.</p> : <>
      <button data-testid="diagnostic-write" disabled={busy} onClick={() => void run('write')}>Guardar muestra</button>
      <button data-testid="diagnostic-read" disabled={busy} onClick={() => void run('read')}>Volver a leer</button>
      <button data-testid="diagnostic-rollback" disabled={busy} onClick={() => void run('rollback')}>Probar reversión</button>
      <pre data-testid="diagnostic-report" aria-live="polite">{report || 'Leyendo base de prueba…'}</pre>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
