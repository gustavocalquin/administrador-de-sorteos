import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CatalogService } from '../application/catalog-service';
import { money, parseInteger, type BuyerRecord, type RaffleDetails } from '../domain/catalog';
import { PAGE_SIZE, numberStateLabel, type Board, type HistoryEntry, type NumberView } from '../domain/operations';
import { HistoryList, OperationSheet } from './OperationSheet';
import { RaffleImages } from './RaffleImages';
import { RaffleClosing } from './RaffleClosing';

export function RaffleBoard({ raffleId, revision, service, backRef, onDirty, onBusy, onChanged, onActivated }: {
  raffleId: string; revision: number; service: CatalogService; backRef: RefObject<(() => boolean) | null>;
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onChanged: () => void;
  onActivated: (value: RaffleDetails) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null); const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [multi, setMulti] = useState(false); const [selected, setSelected] = useState<NumberView[]>([]);
  const [sheet, setSheet] = useState<{ numbers: NumberView[]; revision: number; status: string } | null>(null); const [sheetDirty, setSheetDirty] = useState(false);
  const [imagesDirty, setImagesDirty] = useState(false);
  const [closingDirty, setClosingDirty] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState<number | null>(null);
  const [buyers, setBuyers] = useState<BuyerRecord[]>([]); const [find, setFind] = useState(''); const [highlight, setHighlight] = useState<number | null>(null);
  const [tab, setTab] = useState<'grid' | 'reservations' | 'history' | 'images' | 'closing'>('grid');
  const [reserved, setReserved] = useState<NumberView[]>([]); const [reserveOffset, setReserveOffset] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const sheetBack = useRef<(() => boolean) | null>(null);
  useEffect(() => {
    let active = true; setLoading(true);
    Promise.all([service.operations.board(raffleId, offset), service.listBuyers(), service.operations.reservations(raffleId, reserveOffset), service.operations.history(raffleId)])
      .then(([data, people, reservations, entries]) => { if (active) { setBoard(data); setBuyers(people); setReserved(reservations); setHistory(entries); setHasMoreHistory(entries.length === 30); setError(''); setLoading(false); } })
      .catch(() => { if (active) { setError('No se pudo actualizar la grilla. Reintentá antes de operar.'); setLoading(false); setBoard(null); } });
    return () => { active = false; };
  }, [service, raffleId, revision, offset, reserveOffset, refresh]);
  useEffect(() => { onDirty(sheetDirty || imagesDirty || closingDirty || selected.length > 0); return () => onDirty(false); }, [sheetDirty, imagesDirty, closingDirty, selected.length, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { backRef.current = () => { if (busy) return true; if (sheetBack.current) return sheetBack.current(); if (tab !== 'grid' && !imagesDirty && !closingDirty) { setTab('grid'); return true; } return false; }; return () => { backRef.current = null; }; });
  async function openNumber(number: NumberView) {
    if (loading || busy) return;
    setError(''); setMessage('');
    if (multi && tab === 'grid') {
      if (number.status !== 'disponible') return;
      if (!selected.length) setSelectionRevision(board!.revision);
      setSelected(values => values.some(v => v.value === number.value) ? values.filter(v => v.value !== number.value) : [...values, number]);
    } else setSheet({ numbers: [number], revision: board!.revision, status: board!.raffle.status });
  }
  async function goToNumber() {
    if (!board || busy) return;
    try {
      const value = parseInteger(find); const number = await service.operations.number(raffleId, value);
      const page = Math.floor((value - board.raffle.startNumber) / PAGE_SIZE) * PAGE_SIZE;
      setOffset(page); setTab('grid'); setHighlight(value); setSheet({ numbers: [number], revision: board.revision, status: board.raffle.status }); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo localizar el número.'); }
  }
  async function moreHistory() {
    setBusy(true);
    try { const entries = await service.operations.history(raffleId, undefined, history.at(-1)?.sequence); setHistory(h => [...h, ...entries]); setHasMoreHistory(entries.length === 30); }
    catch { setError('No se pudo leer el historial anterior.'); }
    finally { setBusy(false); }
  }
  async function activate() {
    if (!board || busy) return;
    setBusy(true); setError('');
    try {
      const value = await service.setSalesState(raffleId, board.revision, 'activo');
      setBoard(current => current ? { ...current, raffle: value.raffle, revision: value.revision } : current);
      onActivated(value);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo activar el sorteo.'); }
    finally { setBusy(false); }
  }
  const closed = board && ['ventas_cerradas','sorteado','archivado'].includes(board.raffle.status);
  return <section className="raffle-board" aria-label="Gestión de números">
    {loading && <p role="status">Actualizando números…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="text-button" disabled={loading || busy || sheet !== null} onClick={() => { setSelected([]); setRefresh(v => v + 1); }}>Actualizar grilla</button>
    {message && <p role="status" className="toast">{message}</p>}
    {board && <>
      <div className="board-stats"><div><strong>{board.available}</strong><span>{closed ? 'No vendidos' : 'Libres'}</span></div><div><strong>{board.reserved}</strong><span>Reservados</span></div><div><strong>{board.sold}</strong><span>Vendidos</span></div></div>
      <p className="collection">Recaudación: <strong>{money(board.collectedCents)}</strong></p>
      {board.imageDirty && <p className="hint">Imagen desactualizada · Actualizala desde Imágenes cuando quieras compartir.</p>}
      {board.raffle.status !== 'activo' && <p className="notice compact">{board.raffle.status === 'pausado' ? 'Ventas pausadas. Podés cobrar reservas y corregir asignaciones existentes.' : board.raffle.status === 'borrador' ? 'Activá este sorteo para empezar a reservar y vender.' : 'Solo consulta: las operaciones están bloqueadas.'}</p>}
      <div className="primary-actions">{board.raffle.status === 'borrador' && <button disabled={busy || imagesDirty || closingDirty || selected.length > 0} onClick={() => void activate()}>Activar sorteo</button>}
        <button className="secondary" disabled={busy || imagesDirty || closingDirty || selected.length > 0} onClick={() => setTab('images')}>Compartir sorteo</button></div>
      <div className="board-tabs" role="group" aria-label="Vistas del sorteo">{(['grid', 'reservations', 'history', 'images', 'closing'] as const).map(t => <button key={t} className={tab === t ? '' : 'secondary'} aria-pressed={tab === t} disabled={busy || ((imagesDirty || closingDirty || selected.length > 0) && t !== tab)} onClick={() => setTab(t)}>{t === 'grid' ? 'Números' : t === 'reservations' ? `Reservas (${board.reserved})` : t === 'images' ? 'Imágenes' : t === 'closing' ? 'Cierre y resultados' : 'Historial'}</button>)}</div>
      {tab === 'closing' && <RaffleClosing raffleId={raffleId} revision={board.revision} reserved={board.reserved} sold={board.sold} service={service} onDirty={setClosingDirty} onBusy={setBusy} onChanged={() => { setRefresh(n => n+1); onChanged(); }} onReservations={() => setTab('reservations')} />}
      {tab === 'images' && <RaffleImages raffleId={raffleId} revision={board.revision} service={service} onDirty={setImagesDirty} onBusy={setBusy} onChanged={() => { setRefresh(n => n + 1); onChanged(); }} />}
      {tab === 'grid' && <>
        <form className="number-search" onSubmit={e => { e.preventDefault(); void goToNumber(); }}><label>Ir al número<input inputMode="text" value={find} onChange={e => setFind(e.target.value)} /></label><button type="submit" disabled={loading || busy}>Ir</button></form>
        <div className="form-actions"><button className="secondary" aria-pressed={multi} disabled={loading || busy || board.raffle.status !== 'activo'} onClick={() => { setMulti(!multi); setSelected([]); }}>{multi ? 'Salir de selección múltiple' : 'Selección múltiple'}</button>
          <button className="text-button" disabled={loading || busy || board.raffle.status !== 'activo'} onClick={() => { setMulti(true); setMessage('Tocá los números disponibles y luego Operar selección.'); }}>Nueva operación</button></div>
        <p className="grid-legend">○ {closed ? 'No vendido' : 'Libre'} · ◷ Reservado · ✓ Vendido</p>
        {multi && <p className="hint">Elegí solo números disponibles. La selección se conserva al cambiar de página.</p>}
        <div className="number-grid" aria-label="Números del sorteo">{board.numbers.map(n => <button key={n.value} className={`number-cell ${n.status} ${highlight === n.value ? 'highlight' : ''}`} aria-label={`Número ${n.value}, ${closed && n.status === 'disponible' ? 'No vendido' : numberStateLabel[n.status]}`} aria-pressed={multi ? selected.some(s => s.value === n.value) : undefined}
          disabled={loading || busy || (multi && n.status !== 'disponible')} onClick={() => void openNumber(n)}><span>{n.value}</span><small aria-hidden="true">{n.status === 'vendido' ? '✓' : n.status === 'reservado' ? '◷' : '○'}</small></button>)}</div>
        <div className="pagination"><button className="secondary" disabled={offset === 0 || loading || busy} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button><span>{board.numbers[0]?.value} a {board.numbers.at(-1)?.value}</span><button className="secondary" disabled={offset + PAGE_SIZE >= board.raffle.quantity || loading || busy} onClick={() => setOffset(offset + PAGE_SIZE)}>Siguiente</button></div>
        {multi && <div className="selection-bar"><p>{selected.length} elegidos · {money(selected.reduce((sum, n) => sum + n.unitPriceCents, 0))}</p><button disabled={!selected.length || loading || busy} onClick={() => setSheet({ numbers: selected, revision: selectionRevision ?? board.revision, status: board.raffle.status })}>Operar selección</button></div>}
      </>}
      {tab === 'reservations' && <><p className="hint">Las reservas no vencen ni se liberan automáticamente.</p>{!reserved.length && <p className="notice">No hay reservas en esta página.</p>}<ul className="reservation-list">{reserved.map(n => <li key={n.value}><button className="secondary" disabled={busy || loading} onClick={() => void openNumber(n)}>N.º {n.value} · {n.buyerName}<small>{money(n.unitPriceCents)} pendientes · {new Date(n.assignedAt!).toLocaleDateString('es-AR')}</small></button></li>)}</ul><div className="pagination"><button className="secondary" disabled={!reserveOffset || loading || busy} onClick={() => setReserveOffset(Math.max(0, reserveOffset - PAGE_SIZE))}>Reservas anteriores</button><button className="secondary" disabled={reserveOffset + PAGE_SIZE >= board.reserved || loading || busy} onClick={() => setReserveOffset(reserveOffset + PAGE_SIZE)}>Más reservas</button></div></>}
      {tab === 'history' && <><h2>Historial del sorteo</h2><HistoryList entries={history} />{hasMoreHistory && <button disabled={busy || loading} onClick={() => void moreHistory()}>Ver anteriores</button>}</>}
      {sheet && <OperationSheet numbers={sheet.numbers} raffleId={raffleId} raffleRevision={sheet.revision} raffleStatus={sheet.status} service={service} buyers={buyers} backRef={sheetBack} onBusy={setBusy} onDirty={setSheetDirty}
        onClose={() => { setSheet(null); setSheetDirty(false); }} onCompleted={text => { setSheet(null); setSheetDirty(false); setSelected([]); setMulti(false); setMessage(text); setRefresh(r => r + 1); onChanged(); }} />}
    </>}
  </section>;
}
