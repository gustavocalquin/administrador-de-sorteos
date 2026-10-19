import { useEffect, useRef, useState } from 'react';
import type { CatalogService } from '../application/catalog-service';
import { parseInteger, type RaffleDetails } from '../domain/catalog';
import type { ClosingView } from '../domain/closing';

export function RaffleClosing({ raffleId, revision, reserved, sold, service, onDirty, onBusy, onChanged, onReservations }: {
  raffleId: string; revision: number; reserved: number; sold: number; service: CatalogService;
  onDirty: (v: boolean) => void; onBusy: (v: boolean) => void; onChanged: () => void; onReservations: () => void;
}) {
  const [data,setData] = useState<{ details: RaffleDetails; view: ClosingView } | null>(null);
  const [refresh,setRefresh] = useState(0); const [busy,setBusy] = useState(false); const inFlight = useRef(false);
  const [error,setError] = useState(''); const [message,setMessage] = useState(''); const [confirmed,setConfirmed] = useState(false);
  const [prize,setPrize] = useState(''); const [number,setNumber] = useState(''); const [reason,setReason] = useState('');
  useEffect(() => {
    let active = true; setData(null);
    Promise.all([service.getRaffle(raffleId),service.closing.view(raffleId)]).then(([details,view]) => {
      if (active) { setData({details,view}); setError(''); }
    }).catch(() => { if (active) setError('No se pudieron leer los datos de cierre.'); });
    return () => { active = false; };
  },[service,raffleId,revision,refresh]);
  useEffect(() => { onDirty(confirmed || !!number || !!reason); return () => onDirty(false); },[confirmed,number,reason,onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); },[busy,onBusy]);
  async function run(work: () => Promise<string>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { setMessage(await work()); setConfirmed(false); setNumber(''); setReason(''); setRefresh(n => n+1); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const r = data?.details.raffle; const view = data?.view;
  const prizeId = prize || data?.details.prizes[0]?.id || '';
  const previous = view?.results.find(p => p.prizeId === prizeId);
  return <section className="form-card"><h2>Cierre y resultados</h2>
    {!data && !error && <p role="status">Leyendo cierre…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}
    {data && r && view && <fieldset disabled={busy}>
      {['activo','pausado'].includes(r.status) && <>
        <p>{sold} vendidos · {reserved} reservas impagas · {r.quantity - sold - reserved} libres.</p>
        <p className="notice">Los números reservados que no fueron pagados quedarán como no vendidos y no participarán del sorteo. ¿Deseás continuar?</p>
        {r.participants === 'todos' && <p>En «todos los números», se cancela el derecho del reservante. El número puede salir sin comprador y se aplica esta regla: <strong>{r.unsoldRule}</strong></p>}
        <button type="button" className="text-button" onClick={() => { setConfirmed(false); onReservations(); }}>Revisar reservas</button>
        <label className="check-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo cancelar todas las reservas impagas y congelar los participantes.</label>
        <button disabled={!confirmed} onClick={() => void run(async () => { await service.closing.close(raffleId,data.details.revision,confirmed); return 'Ventas cerradas. Las reservas impagas se cancelaron.'; })}>Confirmar cierre de ventas</button>
      </>}
      {r.status === 'borrador' && <p>Activá el sorteo antes de cerrar sus ventas.</p>}
      {['ventas_cerradas','sorteado','archivado'].includes(r.status) && <>
        <p>Cierre: {view.closure ? new Date(view.closure.closedAt).toLocaleString('es-AR') : 'No disponible'}.</p>
        <p>{view.closure?.snapshot.sold.length ?? 0} números vendidos con derecho adquirido. Los participantes se conservan según este cierre.</p>
        {r.status === 'ventas_cerradas' && !view.hasDraws && <details><summary>Reabrir ventas</summary><p>Volverán a estar activas. Las reservas canceladas no se restaurarán.</p>
          <button className="secondary" onClick={() => void run(async () => { await service.closing.reopen(raffleId,data.details.revision); return 'Ventas reabiertas sin restaurar reservas.'; })}>Reabrir sin restaurar reservas</button></details>}
        {view.hasDraws && <p className="hint">La reapertura está bloqueada porque ya se registró una extracción.</p>}
        <ol className="result-list">{data.details.prizes.map(p => { const result = view.results.find(x => x.prizeId === p.id); return <li key={p.id}>
          <strong>{p.description}</strong><p>{result ? `N.º ${result.number} · ${result.buyer ? `${result.buyer.firstName} ${result.buyer.lastName}` : 'Premio vacante, sin comprador'}` : 'Resultado pendiente'}</p></li>; })}</ol>
        {r.status !== 'archivado' && <form onSubmit={e => { e.preventDefault(); void run(async () => {
          const outcome = await service.closing.record(raffleId,data.details.revision,prizeId,parseInteger(number),reason);
          return outcome === 'repetir' ? 'Extracción registrada sin ganador. Repetí la extracción externa para este premio.' : previous ? 'Resultado corregido con historial.' : 'Resultado registrado.';
        }); }}>
          <h3>{previous ? 'Corregir resultado' : 'Registrar extracción'}</h3>
          <p>Registro manual según {view.closure?.snapshot.method}. La app no verifica una fuente oficial ni realiza el sorteo.</p>
          <label>Premio<select value={prizeId} onChange={e => { setPrize(e.target.value); setNumber(''); setReason(''); }}>{data.details.prizes.map(p => <option key={p.id} value={p.id}>{p.position}. {p.description}</option>)}</select></label>
          <label>Número extraído<input value={number} onChange={e => setNumber(e.target.value)} required inputMode="text" /></label>
          {previous && <label>Motivo de la corrección<textarea value={reason} onChange={e => setReason(e.target.value)} required /></label>}
          <button type="submit">{previous ? 'Guardar corrección de resultado' : 'Registrar número extraído'}</button>
        </form>}
        {view.draws.length > 0 && <details><summary>Extracciones y correcciones registradas</summary><ol className="history-list">{view.draws.map((d,i) => <li key={i}>N.º {d.number} · {d.outcome} · Premio {data.details.prizes.find(p => p.id === d.prizeId)?.position}<time>{new Date(d.recordedAt).toLocaleString('es-AR')}</time>{d.reason && <p>Motivo: {d.reason}</p>}</li>)}</ol></details>}
        {r.status === 'sorteado' && <details><summary>Archivar sorteo</summary><p>Conservarás los datos para consulta. Ya no podrás corregir resultados.</p><button className="secondary" onClick={() => void run(async () => { await service.closing.archive(raffleId,data.details.revision); return 'Sorteo archivado para consulta.'; })}>Confirmar archivo del sorteo</button></details>}
      </>}
    </fieldset>}
  </section>;
}
