import { useEffect, useRef, useState } from 'react';
import type { CatalogService } from '../application/catalog-service';
import { publicConditionSections, type GraphicSet, type PublicRaffle } from '../domain/graphics';
import { renderGraphics } from '../graphics/renderer';
import { sendImages } from '../infrastructure/sharing/public-images';

export function RaffleImages({ raffleId, revision, service, onDirty, onBusy, onChanged, render = renderGraphics, send = sendImages }: {
  raffleId: string; revision?: number; service: CatalogService; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onChanged: () => void;
  render?: typeof renderGraphics; send?: typeof sendImages;
}) {
  const [snapshot, setSnapshot] = useState<PublicRaffle | null>(null); const [set, setSet] = useState<GraphicSet | null>(null);
  const [notes, setNotes] = useState(''); const [locked, setLocked] = useState(false); const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(''); const [preview, setPreview] = useState(0); const inFlight = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const dirty = snapshot !== null && notes !== snapshot.notes;
  const current = !!set && snapshot?.revision === set.revision && (revision === undefined || revision === set.revision) && !dirty;
  useEffect(() => {
    let active = true;
    Promise.all([service.graphics.snapshot(raffleId), service.graphics.get(raffleId), service.getRaffle(raffleId)])
      .then(([s, generated, details]) => { if (active) { setSnapshot(s); setNotes(s.notes); setSet(generated); setSelected(generated?.images.map((_, i) => i) ?? []); setLocked(details.locked || !['borrador', 'activo', 'pausado'].includes(s.status)); setError(''); } })
      .catch(() => { if (active) setError('No se pudieron abrir las imágenes. Reintentá.'); });
    return () => { active = false; };
  }, [service, raffleId, attempt]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar. Intentá otra vez.'); }
    finally { inFlight.current = false; setBusy(false); setProgress(''); }
  }
  async function generate() {
    if (!snapshot) return;
    await run(async () => {
      if (dirty) await service.graphics.saveNotes(raffleId, snapshot.revision, notes);
      const fresh = await service.graphics.snapshot(raffleId); setSnapshot(fresh); setNotes(fresh.notes); onChanged();
      const images = await render(fresh, (done, total) => setProgress(`Generando ${done} de ${total}…`));
      const generated = await service.graphics.save(raffleId, fresh.revision, images);
      setSet(generated); setSelected(images.map((_, i) => i)); setPreview(0); setMessage('Imágenes listas. Revisá las piezas antes de compartir.'); onChanged();
    });
  }
  async function output(action: 'share' | 'export') {
    if (!set) return;
    await run(async () => {
      await service.graphics.assertCurrent(raffleId, set.id);
      const images = set.images.filter((_, i) => selected.includes(i));
      setMessage(await send(images, action));
    });
  }
  async function download(index: number) {
    if (!set) return;
    await run(async () => {
      await service.graphics.assertCurrent(raffleId, set.id);
      const p = set.images[index]!; const bytes = Uint8Array.from(atob(p.dataUrl.split(',')[1]!), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const link = document.createElement('a'); link.href = url; link.download = `sorteo-${set.id}-${String(index + 1).padStart(3, '0')}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000); setMessage('PNG preparado para descargar en el navegador.');
    });
  }
  return <section className="raffle-images" aria-label="Imágenes del sorteo">
    <h2>Imágenes para compartir</h2><p>Grillas y bases en formato vertical. Se generan cuando vos lo pedís.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {!snapshot ? <button disabled={busy} onClick={() => setAttempt(n => n + 1)}>Reintentar imágenes</button> : <>
      <details className="conditions-editor"><summary>Revisar bases y condiciones</summary>
        <p className="hint">Borrador derivado del sorteo. Revisalo antes de difundir; no es asesoramiento jurídico. Los datos principales se editan en la configuración del sorteo.</p>
        <div className="conditions-copy"><h4>{snapshot.name}</h4>{publicConditionSections({ ...snapshot, notes: '' }).map(section => <section key={section.title}><h5>{section.title}</h5>{section.paragraphs.map((line, i) => <p key={i}>{line}</p>)}</section>)}</div>
        <label>Aclaraciones para las bases<textarea disabled={busy || locked} rows={5} maxLength={12000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <p className="hint">{locked ? 'Ya hay operaciones o el sorteo está cerrado: las bases están protegidas.' : 'Se guardarán al generar. No incluyas datos privados de compradores.'}</p>
      </details>
      <p className={current ? 'hint' : 'notice compact'}>{!set ? 'Todavía no hay imágenes generadas.' : current ? `Generadas: ${new Date(set.generatedAt).toLocaleString('es-AR')}` : 'Imagen desactualizada. Generá una nueva para incluir los cambios.'}</p>
      <button disabled={busy} onClick={() => void generate()}>{busy && progress ? progress : 'Generar nueva imagen'}</button>
      {message && <p role="status" className="toast">{message}</p>}
      {set && <>
        <h3>Vista previa · {set.images.length} piezas</h3><p>Se seleccionan todas las grillas y bases. Podés desmarcar piezas; el orden se conserva.</p>
        <fieldset disabled={busy}><div className="form-actions"><button type="button" className="secondary" onClick={() => setSelected(set.images.map((_, i) => i))}>Seleccionar todas</button><button type="button" className="text-button" onClick={() => setSelected([])}>Desmarcar todas</button></div>
          <ul className="image-selection">{set.images.map((p, i) => <li key={i}><label><input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(values => e.target.checked ? [...values, i] : values.filter(v => v !== i))} />{p.title}</label><button className="text-button" type="button" aria-label={`Ver pieza ${i + 1}`} onClick={() => setPreview(i)}>Ver</button></li>)}</ul>
        </fieldset>
        <figure className="image-preview"><img src={set.images[preview]!.dataUrl} alt={set.images[preview]!.title} width={1080} height={1920} /><figcaption>{set.images[preview]!.title} · 1080 × 1920</figcaption></figure>
        <div className="form-actions"><button disabled={busy || !current || !selected.length} onClick={() => void output('share')}>Compartir selección ({selected.length})</button><button className="secondary" disabled={busy || !current || !selected.length} onClick={() => void output('export')}>Exportar a carpeta</button></div>
        <p className="hint">Android abre su selector. La recepción de varias imágenes depende de la app elegida; no se publican automáticamente en Estados.</p>
        {service.storage === 'preview' && <><p className="notice compact">Demo de navegador: compartir y exportar el conjunto se prueban en Android.</p><button className="secondary" disabled={busy || !current} onClick={() => void download(preview)}>Descargar PNG visible</button></>}
      </>}
    </>}
  </section>;
}
