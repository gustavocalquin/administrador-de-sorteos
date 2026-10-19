import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CatalogService } from '../application/catalog-service';
import { money, normalizePhone, type BuyerInput, type BuyerRecord } from '../domain/catalog';
import { numberStateLabel, type BuyerChoice, type HistoryEntry, type NumberView } from '../domain/operations';

const emptyBuyer: BuyerInput = { phone: '', firstName: '', lastName: '', email: null, notes: '' };
export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  const labels: Record<string, string> = { cerrar_ventas: 'Ventas cerradas y reservas impagas canceladas', reabrir_ventas: 'Ventas reabiertas sin restaurar reservas', registrar_extraccion: 'Extracción manual registrada', corregir_resultado: 'Resultado corregido', archivar: 'Sorteo archivado', reserva: 'Reserva', venta: 'Venta', confirmar_pago: 'Pago confirmado', limpiar: 'Número liberado', corregir_comprador: 'Comprador corregido', editar_bases: 'Aclaraciones de bases editadas', crear: 'Sorteo creado', editar_configuracion: 'Configuración editada', activar: 'Sorteo activado', pausar: 'Ventas pausadas' };
  return <ol className="history-list">{entries.map(entry => {
    let before: NumberView[] = []; let after: NumberView[] = [];
    try { const b: unknown = JSON.parse(entry.beforeJson ?? 'null'); const a: unknown = JSON.parse(entry.afterJson ?? 'null');
      if (Array.isArray(b)) before = b; if (Array.isArray(a)) after = a;
    } catch { /* Legacy non-operational history remains visible by action and date. */ }
    return <li key={entry.id}><strong>{labels[entry.action] ?? entry.action}</strong><time>{new Date(entry.createdAt).toLocaleString('es-AR')}</time>
      {after.map(n => <p key={n.value}>N.º {n.value}: {numberStateLabel[before.find(b => b.value === n.value)?.status ?? 'disponible']} → {numberStateLabel[n.status]}
        {n.buyerName ? ` · ${n.buyerName}` : ''}{n.status === 'vendido' ? ` · ${money(n.unitPriceCents)}` : ''}
        {entry.action === 'corregir_comprador' && <span> (antes: {before.find(b => b.value === n.value)?.buyerName})</span>}</p>)}
      {entry.reason && <p>Motivo: {entry.reason}</p>}</li>;
  })}</ol>;
}

export function OperationSheet({ numbers, raffleId, raffleRevision, raffleStatus, service, buyers, onClose, onCompleted, onDirty, onBusy, backRef }: {
  numbers: NumberView[]; raffleId: string; raffleRevision: number; raffleStatus: string; service: CatalogService; buyers: BuyerRecord[];
  onClose: () => void; onCompleted: (message: string) => void; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void;
  backRef: RefObject<(() => boolean) | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'detail' | 'reserva' | 'venta' | 'pay' | 'clear' | 'correct' | 'history'>('detail');
  const [buyer, setBuyer] = useState<BuyerInput>(emptyBuyer);
  const [existing, setExisting] = useState<BuyerRecord | null>(null);
  const [reason, setReason] = useState(''); const [refund, setRefund] = useState(false);
  const [group, setGroup] = useState<NumberView[]>([]); const [payValues, setPayValues] = useState<number[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState(''); const [discard, setDiscard] = useState(false);
  const n = numbers[0]!;
  const dirty = buyer !== emptyBuyer || existing !== null || !!reason || refund || mode === 'pay';
  const allowed = ['activo', 'pausado'].includes(raffleStatus);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  function close() { if (busy || inFlight.current) return; if (dirty) setDiscard(true); else onClose(); }
  useEffect(() => { backRef.current = () => { if (discard) setDiscard(false); else close(); return true; }; return () => { backRef.current = null; }; });
  const matches = normalizePhone(buyer.phone) ? buyers.filter(b => b.phoneKey.includes(normalizePhone(buyer.phone))) : [];
  const choice = (): BuyerChoice => existing ? { kind: 'existing', id: existing.id } : { kind: 'new', input: buyer };
  async function run(work: () => Promise<void>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await work(); onCompleted(message); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar. Los cambios no se confirmaron.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function openPay() {
    setBusy(true); setError('');
    try { const values = await service.operations.reservationGroup(raffleId, n.operationId!); if (!values.some(item => item.value === n.value)) throw new Error('La reserva cambió.'); setGroup(values); setPayValues([n.value]); setMode('pay'); }
    catch { setError('No se pudo abrir la reserva. Cerrá el panel y actualizá la grilla.'); }
    finally { setBusy(false); }
  }
  async function showHistory(more = false) {
    setBusy(true); setError('');
    try { const entries = await service.operations.history(raffleId, n.value, more ? history.at(-1)?.sequence : undefined);
      setHistory(h => more ? [...h, ...entries] : entries); setHasMoreHistory(entries.length === 30); setMode('history'); }
    catch { setError('No se pudo leer el historial. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }
  const amount = mode === 'pay' ? group.filter(item => payValues.includes(item.value)).reduce((sum, item) => sum + item.unitPriceCents, 0) : numbers.reduce((sum, item) => sum + item.unitPriceCents, 0);
  const selectBuyer = (b: BuyerRecord) => { setExisting(b); setBuyer({ phone: b.phone, firstName: b.firstName, lastName: b.lastName, email: b.email, notes: b.notes }); };
  return <dialog ref={dialog} className={`operation-sheet ${mode !== 'detail' ? 'expanded' : ''}`} aria-labelledby="operation-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="sheet-handle" aria-hidden="true" /><div className="page-heading"><h2 id="operation-title">{numbers.length === 1 ? `Número ${n.value}` : `${numbers.length} números elegidos`}</h2><button className="text-button" aria-label="Cerrar panel" disabled={busy} onClick={close}>×</button></div>
    {discard ? <section><h3>Hay cambios sin guardar</h3><p>¿Querés descartar los datos de esta operación?</p><div className="form-actions"><button onClick={() => setDiscard(false)}>Seguir editando</button><button className="secondary" onClick={onClose}>Descartar cambios</button></div></section> : <>
      <p className="chosen-numbers">{numbers.map(item => item.value).join(' · ')}</p>
      {mode === 'detail' && <><span className={`pill ${n.status}`}>{numberStateLabel[n.status]}</span>
        {n.buyerName && <><h3>{n.buyerName}</h3><p>{n.phone}</p><p className="hint">Desde {new Date(n.assignedAt!).toLocaleString('es-AR')}</p></>}
        <p className="operation-total">{money(amount)} {n.status === 'reservado' ? 'pendientes' : n.status === 'vendido' ? 'pagados' : 'en total'}</p>
        {n.status === 'reservado' && <p className="hint">La reserva no vence automáticamente.</p>}
        {!allowed && <p className="notice">{raffleStatus === 'borrador' ? 'Activá el sorteo para reservar o vender.' : 'Las operaciones están bloqueadas en este estado.'}</p>}
        <div className="form-actions">{n.status === 'disponible' ? <><button disabled={busy || raffleStatus !== 'activo'} onClick={() => setMode('reserva')}>Reservar</button><button disabled={busy || raffleStatus !== 'activo'} onClick={() => setMode('venta')}>Vender</button></> : <>
          {n.status === 'reservado' && <button disabled={busy || !allowed} onClick={() => void openPay()}>Confirmar pago</button>}
          <button className="secondary" disabled={busy || !allowed} onClick={() => setMode('correct')}>Corregir comprador</button>
          <button className="secondary" disabled={busy || !allowed} onClick={() => setMode('clear')}>Limpiar número</button></>}
          {numbers.length === 1 && <button className="text-button" disabled={busy} onClick={() => void showHistory()}>Historial del número</button>}</div>
      </>}
      {['reserva', 'venta', 'correct'].includes(mode) && <form noValidate onSubmit={e => { e.preventDefault(); void run(() => mode === 'correct'
        ? service.operations.correctBuyer(raffleId, n, choice(), reason)
        : service.operations.assign(raffleId, raffleRevision, numbers, choice(), mode as 'reserva' | 'venta'), mode === 'correct' ? 'Comprador corregido.' : mode === 'reserva' ? 'Reserva guardada.' : 'Venta guardada.'); }}>
        <fieldset disabled={busy}><p>{mode === 'correct' ? 'Se cambia solo este número; el estado de pago y el precio se conservan.' : `${money(amount)} · ${mode === 'reserva' ? 'Sin pago inicial' : 'Pago completo'}`}</p>
          <label>Teléfono<input type="tel" autoComplete="off" value={buyer.phone} readOnly={existing !== null} onChange={e => setBuyer(b => ({ ...b, phone: e.target.value }))} required /></label>
          {!existing && matches.length > 0 && <div className="suggestions"><strong>Compradores con este teléfono</strong><p className="hint">Elegí una ficha o continuá para guardar otra persona.</p>{matches.slice(0, 10).map(b => <button key={b.id} className="secondary" type="button" onClick={() => selectBuyer(b)}>Usar {b.firstName} {b.lastName}<small>{b.phone}</small></button>)}</div>}
          {existing && <div className="notice compact">Usando ficha existente. No se duplicará.<button type="button" className="text-button" onClick={() => { setExisting(null); setBuyer(emptyBuyer); }}>Elegir otra persona</button></div>}
          <label>Nombre<input autoComplete="off" value={buyer.firstName} readOnly={existing !== null} onChange={e => setBuyer(b => ({ ...b, firstName: e.target.value }))} required /></label>
          <label>Apellido<input autoComplete="off" value={buyer.lastName} readOnly={existing !== null} onChange={e => setBuyer(b => ({ ...b, lastName: e.target.value }))} required /></label>
          {mode === 'correct' && <label>Motivo de la corrección<textarea value={reason} onChange={e => setReason(e.target.value)} required /></label>}
          <button className="full-width" type="submit">{busy ? 'Guardando…' : mode === 'correct' ? 'Guardar corrección' : mode === 'reserva' ? 'Confirmar reserva' : 'Confirmar venta'}</button>
        </fieldset></form>}
      {mode === 'pay' && <form onSubmit={e => { e.preventDefault(); void run(() => service.operations.pay(raffleId, group.filter(item => payValues.includes(item.value))), 'Pago confirmado; los demás números siguen reservados.'); }}>
        <fieldset disabled={busy}><h3>Qué números pagó</h3><p>Elegí números completos de esta reserva.</p><div className="payment-choices">{group.map(item => <label key={item.value}><input type="checkbox" checked={payValues.includes(item.value)} onChange={e => setPayValues(values => e.target.checked ? [...values, item.value] : values.filter(v => v !== item.value))} />N.º {item.value} · {money(item.unitPriceCents)}</label>)}</div>
          <p className="operation-total">Total a confirmar: {money(amount)}</p><button className="full-width" disabled={!payValues.length} type="submit">Confirmar pago de {payValues.length} {payValues.length === 1 ? 'número' : 'números'}</button></fieldset></form>}
      {mode === 'clear' && <form noValidate onSubmit={e => { e.preventDefault(); void run(() => service.operations.clear(raffleId, numbers, reason, refund), 'Número liberado. Se conservó el historial.'); }}>
        <fieldset disabled={busy}><h3>Liberar el número</h3><p>Volverá a disponible y se quitará su comprador. El historial se conserva.</p>
          {n.status === 'vendido' && <div className="form-error"><strong>Esta venta ya estaba pagada.</strong><p>Puede corresponder devolver {money(amount)}. La app no realiza devoluciones.</p><label className="check-label"><input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} />Revisé la posible devolución de dinero</label></div>}
          <label>Motivo de la limpieza<textarea value={reason} onChange={e => setReason(e.target.value)} required /></label><button className="danger full-width" type="submit" disabled={n.status === 'vendido' && !refund}>Confirmar limpieza</button></fieldset></form>}
      {mode === 'history' && <><h3>Historial del número</h3>{!history.length && <p>No hay movimientos para este número.</p>}<HistoryList entries={history} />{hasMoreHistory && <button disabled={busy} onClick={() => void showHistory(true)}>Ver anteriores</button>}</>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </dialog>;
}
