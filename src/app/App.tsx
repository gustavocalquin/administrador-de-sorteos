import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { openCatalog } from '../application/open-catalog';
import type { CatalogService } from '../application/catalog-service';
import { money, newRaffle, searchBuyers, type BuyerRecord, type RaffleDetails } from '../domain/catalog';
import type { Raffle } from '../domain/models';
import { BuyerEditor } from '../ui/BuyerEditor';
import { RaffleEditor } from '../ui/RaffleEditor';
import { RaffleBoard } from '../ui/RaffleBoard';
import { Backups } from '../ui/Backups';

const Diagnostics = import.meta.env.MODE === 'diagnostic' ? lazy(() => import('../dev/Diagnostics')) : null;
type Page = { kind: 'raffles' | 'buyers' | 'settings' } | { kind: 'raffle' | 'raffle-edit'; value: RaffleDetails } | { kind: 'buyer-edit'; value: BuyerRecord | null };
type ThemePreference = 'system' | 'light' | 'dark';
function savedTheme(): ThemePreference {
  const value = localStorage.getItem('sorteos-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
function DiscardDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby="discard-title" onCancel={e => { e.preventDefault(); onKeep(); }}>
    <h2 id="discard-title">Hay cambios sin guardar</h2><p>Si salís de este formulario, perderás los cambios.</p>
    <div className="form-actions"><button autoFocus onClick={onKeep}>Seguir editando</button><button className="secondary" onClick={onDiscard}>Descartar cambios</button></div>
  </dialog>;
}
function RaffleListItem({ raffle, busy, selected, onOpen, onActions }: {
  raffle: Raffle; busy: boolean; selected: boolean; onOpen: () => void; onActions: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const longPressed = useRef(false);
  function cancelPress() { if (timer.current) clearTimeout(timer.current); timer.current = null; }
  function runClick(action: () => void) {
    if (longPressed.current) { longPressed.current = false; return; }
    action();
  }
  useEffect(() => cancelPress, []);
  return <li className={selected ? 'selected' : ''}
    onPointerDown={event => { if (busy || event.button !== 0) return; longPressed.current = false; start.current = { x: event.clientX, y: event.clientY }; cancelPress(); timer.current = setTimeout(() => { longPressed.current = true; onActions(); }, 650); }}
    onPointerMove={event => { if (Math.abs(event.clientX - start.current.x) > 10 || Math.abs(event.clientY - start.current.y) > 10) cancelPress(); }}
    onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
    onContextMenu={event => { event.preventDefault(); if (!busy) onActions(); }}>
    <button className="raffle-menu" aria-label={`Opciones de ${raffle.name}`} disabled={busy} onClick={() => runClick(onActions)}>⋮</button>
    <span className="pill">{raffle.status.replaceAll('_', ' ')}</span><h2>{raffle.name}</h2>
    <p>{raffle.quantity} números · {raffle.startNumber} al {raffle.startNumber + (raffle.quantity - 1)}</p><p>{money(raffle.unitPriceCents)} por número</p>
    <button className="text-button raffle-open" disabled={busy} onClick={() => runClick(onOpen)}>Abrir {raffle.name}</button>
  </li>;
}
function RaffleActionsDialog({ raffle, busy, onClose, onArchive, onDelete }: {
  raffle: Raffle; busy: boolean; onClose: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const canArchive = raffle.status === 'sorteado';
  return <dialog ref={ref} aria-labelledby="raffle-actions-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="raffle-actions-title">{raffle.name}</h2><p>Elegí qué querés hacer con este sorteo.</p>
    <div className="context-actions"><button className="secondary" disabled={busy || !canArchive} onClick={onArchive}>Archivar</button><button className="danger" disabled={busy} onClick={onDelete}>Borrar</button></div>
    {!canArchive && <p className="context-hint">{raffle.status === 'archivado' ? 'Este sorteo ya está archivado.' : 'Archivar estará disponible cuando estén completos todos los resultados.'}</p>}
    <button className="text-button full-width" disabled={busy} onClick={onClose}>Cancelar</button>
  </dialog>;
}
function DeleteRaffleDialog({ raffle, busy, onCancel, onDelete }: {
  raffle: Raffle; busy: boolean; onCancel: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby="delete-raffle-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="delete-raffle-title">¿Borrar “{raffle.name}”?</h2>
    <p className="danger-text">Se eliminarán sus números, operaciones, historial, imágenes y resultados. Esta eliminación no se puede deshacer. Los compradores seguirán en tu agenda.</p>
    <p>Los respaldos creados anteriormente no se modifican. ¿Querés continuar?</p>
    <div className="form-actions"><button autoFocus className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button><button className="danger" disabled={busy} onClick={onDelete}>Borrar</button></div>
  </dialog>;
}
export function App({ load = openCatalog }: { load?: () => Promise<CatalogService> }) {
  const [service, setService] = useState<CatalogService | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [buyers, setBuyers] = useState<BuyerRecord[]>([]);
  const [page, setPage] = useState<Page>({ kind: 'raffles' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Page | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [backupReminder, setBackupReminder] = useState(false);
  const [raffleActions, setRaffleActions] = useState<Raffle | null>(null);
  const [deleteRaffle, setDeleteRaffle] = useState<Raffle | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(savedTheme);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? media?.matches ? 'dark' : 'light' : theme; };
    localStorage.setItem('sorteos-theme', theme); apply();
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme]);
  useEffect(() => { let active = true; if (service && page.kind === 'raffles') void service.backups.status().then(s => { if (active) setBackupReminder(s.reminder); }).catch(() => undefined); return () => { active = false; }; },[service,page.kind]);
  const heading = useRef<HTMLElement>(null);
  const boardBack = useRef<(() => boolean) | null>(null);
  useEffect(() => {
    let active = true;
    load().then(async catalog => {
      const [r, b] = await Promise.all([catalog.listRaffles(), catalog.listBuyers()]);
      if (active) { setService(catalog); setRaffles(r); setBuyers(b); setLoading(false); setFailed(false); }
    }).catch(() => { if (active) { setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [load, attempt]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty, busy]);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, [page]);
  function go(destination: Page) {
    if (busy) return;
    if (dirty) setPending(destination);
    else { setPage(destination); setError(''); setNotice(''); }
  }
  function back() {
    if (pending) { setPending(null); return; }
    if (page.kind === 'raffle' && boardBack.current?.()) return;
    if (page.kind === 'raffle-edit') go(page.value.revision ? { kind: 'raffle', value: page.value } : { kind: 'raffles' });
    else if (page.kind === 'buyer-edit') go({ kind: 'buyers' });
    else if (page.kind !== 'raffles') go({ kind: 'raffles' });
    else if (!busy) void NativeApp.exitApp();
  }
  const backRef = useRef(back);
  useEffect(() => { backRef.current = back; });
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const listener = NativeApp.addListener('backButton', () => backRef.current());
    return () => { void listener.then(handle => handle.remove()); };
  }, []);
  function acceptRaffle(value: RaffleDetails, message: string) {
    setRaffles(items => [value.raffle, ...items.filter(r => r.id !== value.raffle.id)]);
    setDirty(false); setBusy(false); setPage({ kind: 'raffle', value }); setNotice(message); setError('');
  }
  async function openRaffle(id: string) {
    if (!service || busy) return;
    setBusy(true); setError('');
    try { setPage({ kind: 'raffle', value: await service.getRaffle(id) }); }
    catch { setError('No se pudo abrir el sorteo. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }
  async function raffleAction(action: 'duplicate' | 'activo' | 'pausado') {
    if (!service || page.kind !== 'raffle' || busy) return;
    setBusy(true); setError('');
    try {
      const value = action === 'duplicate' ? await service.duplicateRaffle(page.value.raffle.id) : await service.setSalesState(page.value.raffle.id, page.value.revision, action);
      acceptRaffle(value, action === 'duplicate' ? 'Copia creada sin operaciones.' : 'Estado actualizado.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo realizar el cambio.'); }
    finally { setBusy(false); }
  }
  async function archiveFromList() {
    if (!service || !raffleActions || busy) return;
    setBusy(true); setError('');
    try {
      const value = await service.getRaffle(raffleActions.id);
      await service.closing.archive(raffleActions.id, value.revision);
      setRaffles(await service.listRaffles()); setRaffleActions(null); setNotice('Sorteo archivado.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo archivar el sorteo.'); }
    finally { setBusy(false); }
  }
  async function confirmDeleteRaffle() {
    if (!service || !deleteRaffle || busy) return;
    const id = deleteRaffle.id;
    setBusy(true); setError('');
    try {
      await service.deleteRaffle(id);
      const [remaining, people] = await Promise.all([service.listRaffles(), service.listBuyers()]);
      setRaffles(remaining); setBuyers(people); setRaffleActions(null); setDeleteRaffle(null);
      setPage({ kind: 'raffles' }); setNotice('Sorteo borrado. Los compradores permanecen en tu agenda.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo borrar el sorteo.'); }
    finally { setBusy(false); }
  }
  function buyerSaved() {
    setDirty(false); setBusy(false); setPage({ kind: 'buyers' }); setNotice('Comprador guardado.');
    if (service) void service.listBuyers().then(setBuyers).catch(() => setError('El comprador se guardó, pero no pudimos actualizar la lista. Volvé a abrir la app.'));
  }
  function operationChanged() {
    if (!service || page.kind !== 'raffle') return;
    const id = page.value.raffle.id;
    void Promise.all([service.getRaffle(id), service.listBuyers()]).then(([value, people]) => {
      setBuyers(people); setRaffles(items => items.map(r => r.id === id ? value.raffle : r));
      setPage(current => current.kind === 'raffle' && current.value.raffle.id === id ? { kind: 'raffle', value } : current);
    }).catch(() => setError('La operación se guardó, pero falta actualizar el resumen. Volvé a abrir el sorteo.'));
  }
  const list = searchBuyers(buyers, query);
  const tab = page.kind.startsWith('buyer') ? 'buyers' : page.kind === 'settings' ? 'settings' : 'raffles';
  return <div className="app-shell">
    <header className="brand"><span className="brand-mark" aria-hidden="true">S</span><div>Administrador<span>DE SORTEOS</span></div><span className="version">V1 · Prueba</span></header>
    <main ref={heading} tabIndex={-1}>
      {loading && <section className="notice" role="status">Abriendo tus datos…</section>}
      {failed && <section className="error-card" role="alert"><h1>No pudimos abrir tus datos</h1><p>No se borró ni reinició la base de datos. Intentá nuevamente. Si el problema continúa, conservá la aplicación instalada para revisar el error.</p><button onClick={() => { setLoading(true); setFailed(false); setAttempt(a => a + 1); }}>Reintentar</button></section>}
      {service && !loading && !failed && <>
        <div className="storage-status"><span aria-hidden="true">●</span>{service.storage === 'android' ? 'Datos locales · Sin conexión necesaria' : 'Prueba web · Los datos se pierden al recargar'}</div>
        {notice && <div className="toast" role="status">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice('')}>×</button></div>}
        {page.kind === 'raffles' && <>
          <div className="page-heading"><div><p className="eyebrow">TU ESPACIO</p><h1>Mis sorteos</h1></div><span className="section-icon" aria-hidden="true">#</span></div>
          <p className="intro">Un lugar para organizar cada sorteo, de principio a fin.</p>
          {backupReminder && <p className="notice">Tenés cambios sin respaldar desde hace una semana o más. <button className="text-button" onClick={() => go({ kind: 'settings' })}>Crear una copia</button></p>}
          {raffles.length === 0 ? <section className="empty-state"><div className="ticket" aria-hidden="true"><span>MI PRIMER</span><strong>SORTEO</strong><div>01 <span>02</span> 03</div></div><h2>Todo empieza con un sorteo</h2><p>Elegí los premios y prepará tus números.</p><button className="create-button" onClick={() => go({ kind: 'raffle-edit', value: newRaffle() })}>Crear mi primer sorteo</button></section> : <>
            <button className="create-button" disabled={busy} onClick={() => go({ kind: 'raffle-edit', value: newRaffle() })}>+ Crear sorteo</button>
            <p className="context-hint">Mantené presionado un sorteo para ver sus opciones.</p>
            <ul className="raffle-list">{raffles.map(r => <RaffleListItem key={r.id} raffle={r} busy={busy} selected={raffleActions?.id === r.id}
              onOpen={() => void openRaffle(r.id)} onActions={() => setRaffleActions(r)} />)}</ul></>}
          <aside className="privacy"><span aria-hidden="true">◇</span><div><strong>Tu información queda con vos</strong><p>Sin cuentas ni servidores. En Android, los datos se guardan en tu teléfono.</p></div></aside>
        </>}
        {page.kind === 'buyers' && <>
          <p className="eyebrow">TU AGENDA LOCAL</p><h1>Compradores</h1><p className="intro">Guardá una vez sus datos y reutilizalos en tus sorteos.</p>
          <button className="create-button" onClick={() => go({ kind: 'buyer-edit', value: null })}>+ Nuevo comprador</button>
          <label className="search-field">Buscar comprador<input type="search" placeholder="Nombre, apellido, teléfono o número" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <p className="hint">{list.length} {list.length === 1 ? 'comprador' : 'compradores'}</p>
          {!list.length && <div className="notice">{buyers.length ? 'No hay coincidencias. Probá con otros datos.' : 'Tu agenda está lista para empezar.'}</div>}
          <ul className="buyer-list">{list.map(b => <li key={b.id}><div className="avatar" aria-hidden="true">{b.firstName[0]}{b.lastName[0]}</div><div><h2>{b.lastName}, {b.firstName}</h2><p>{b.phone}</p></div><button className="text-button" aria-label={`Editar ${b.firstName} ${b.lastName}`} onClick={() => go({ kind: 'buyer-edit', value: b })}>Editar</button></li>)}</ul>
        </>}
        {page.kind === 'settings' && <><h1>Ajustes</h1><section className="form-card"><h2>Apariencia</h2><label>Tema<select value={theme} onChange={event => setTheme(event.target.value as ThemePreference)}><option value="system">Usar tema del teléfono</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label><p className="hint">Las imágenes para compartir conservan la plantilla y la paleta elegidas.</p></section><section className="form-card"><h2>Datos privados en tu dispositivo</h2><p>La app funciona sin cuentas ni servidores y no accede a tus contactos.</p><p>Versión 0.7.0-prueba.2 · Versión de prueba</p>{service.storage === 'preview' && <p>Esta prueba web usa una base temporal. Recargar borra los datos de la prueba.</p>}</section>
          <Backups service={service} onDirty={setDirty} onBusy={setBusy} onRestored={async () => {
            const [r,b] = await Promise.all([service.listRaffles(),service.listBuyers()]); setRaffles(r); setBuyers(b); setBackupReminder(false); setQuery('');
          }} /></>}
        {page.kind === 'raffle-edit' && <RaffleEditor key={page.value.raffle.id} initial={page.value} service={service} onSaved={v => acceptRaffle(v, 'Sorteo guardado.')} onCancel={back} onDirty={setDirty} onBusy={setBusy} />}
        {page.kind === 'buyer-edit' && <BuyerEditor key={page.value?.id ?? 'new'} initial={page.value} buyers={buyers} service={service} onSaved={buyerSaved} onSelect={b => go({ kind: 'buyer-edit', value: b })} onCancel={back} onDirty={setDirty} onBusy={setBusy} />}
        {page.kind === 'raffle' && <>
          <button className="text-button" disabled={busy} onClick={back}>← Mis sorteos</button><h1>{page.value.raffle.name}</h1><span className="pill">{page.value.raffle.status.replaceAll('_', ' ')}</span>
          <RaffleBoard key={page.value.raffle.id} raffleId={page.value.raffle.id} revision={page.value.revision} service={service} backRef={boardBack} onDirty={setDirty} onBusy={setBusy} onChanged={operationChanged}
            onActivated={value => acceptRaffle(value, 'Sorteo activado. Ya podés reservar y vender.')} />
          <details className="raffle-settings"><summary>Configuración y opciones del sorteo</summary>
          <section className="form-card"><h2>Listo para organizar</h2><p>{page.value.raffle.description}</p>
            <div className="summary-grid"><div><strong>{page.value.raffle.quantity}</strong><span>Números</span></div><div><strong>{money(page.value.raffle.unitPriceCents)}</strong><span>Por número</span></div></div>
            <p>Del {page.value.raffle.startNumber} al {page.value.raffle.startNumber + (page.value.raffle.quantity - 1)}</p><p>Recaudación potencial: {money(page.value.raffle.quantity * page.value.raffle.unitPriceCents)}</p>
            <h2>Premios</h2><ol>{page.value.prizes.map(p => <li key={p.id}>{p.description}</li>)}</ol>
            <h2>Condiciones</h2><p>{page.value.raffle.drawAt ? new Date(page.value.raffle.drawAt).toLocaleString('es-AR') : 'Fecha a confirmar'}</p><p>{page.value.raffle.drawMethod}</p><p>{page.value.raffle.participants === 'todos' ? 'Todos los números' : 'Solo números vendidos'}</p>
            {page.value.raffle.unsoldRule && <p>Sin comprador: {page.value.raffle.unsoldRule}</p>}<p>Organizador y contacto: {page.value.raffle.publicContact}</p>
            <p>Presentación: {page.value.template} · {page.value.palette}</p>{page.value.image && <img className="detail-image" src={page.value.image} alt="Imagen del sorteo" />}
          </section>
          <div className="form-actions"><button disabled={busy || !['borrador', 'activo', 'pausado'].includes(page.value.raffle.status)} onClick={() => go({ kind: 'raffle-edit', value: page.value })}>Editar sorteo</button>
            <button className="secondary" disabled={busy || dirty} onClick={() => void raffleAction('duplicate')}>Duplicar configuración</button>
            {page.value.raffle.status === 'pausado' && <button className="secondary" disabled={busy || dirty} onClick={() => void raffleAction('activo')}>Reanudar ventas</button>}
            {page.value.raffle.status === 'activo' && <button className="secondary" disabled={busy || dirty} onClick={() => void raffleAction('pausado')}>Pausar ventas</button>}</div>
            <hr /><h2>Administrar sorteo</h2><button className="danger" disabled={busy || dirty} onClick={() => setDeleteRaffle(page.value.raffle)}>Borrar sorteo</button>
          </details>
        </>}
        {error && <p role="alert" className="form-error">{error}</p>}
      </>}
      {Diagnostics && <Suspense fallback={<p role="status">Abriendo diagnóstico…</p>}><Diagnostics /></Suspense>}
    </main>
    <nav aria-label="Navegación principal">{([{ kind: 'raffles', text: 'Sorteos', icon: '▦' }, { kind: 'buyers', text: 'Compradores', icon: '♙' }, { kind: 'settings', text: 'Ajustes', icon: '⚙' }] as const).map(item =>
      <button key={item.kind} className={tab === item.kind ? 'nav-current' : ''} aria-current={tab === item.kind ? 'page' : undefined} disabled={!service || loading || failed || busy} onClick={() => go({ kind: item.kind })}><span aria-hidden="true">{item.icon}</span>{item.text}</button>)}</nav>
    {pending && <DiscardDialog onKeep={() => setPending(null)} onDiscard={() => { setDirty(false); setPage(pending); setPending(null); setError(''); }} />}
    {raffleActions && !deleteRaffle && <RaffleActionsDialog raffle={raffleActions} busy={busy} onClose={() => setRaffleActions(null)} onArchive={() => void archiveFromList()} onDelete={() => setDeleteRaffle(raffleActions)} />}
    {deleteRaffle && <DeleteRaffleDialog raffle={deleteRaffle} busy={busy} onCancel={() => setDeleteRaffle(null)} onDelete={() => void confirmDeleteRaffle()} />}
  </div>;
}
