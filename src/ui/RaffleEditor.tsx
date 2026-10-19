import { useEffect, useState } from 'react';
import { money, parseInteger, parsePrice, priceInput, validateDetails, type RaffleDetails } from '../domain/catalog';
import { validateRaffle } from '../domain/models';
import type { CatalogService } from '../application/catalog-service';
import { unsoldRules, unsoldPolicy } from '../domain/closing';

function localDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function RaffleEditor({ initial, service, onSaved, onCancel, onDirty, onBusy }: {
  initial: RaffleDetails; service: CatalogService; onSaved: (value: RaffleDetails) => void; onCancel: () => void;
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const [value, setValue] = useState(() => structuredClone(initial));
  const [start, setStart] = useState(String(initial.raffle.startNumber));
  const [quantity, setQuantity] = useState(String(initial.raffle.quantity));
  const [price, setPrice] = useState(priceInput(initial.raffle.unitPriceCents));
  const [date, setDate] = useState(localDate(initial.raffle.drawAt));
  const [scheduled, setScheduled] = useState(initial.raffle.drawAt !== null);
  const [advanced, setAdvanced] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const changed = JSON.stringify(value) !== JSON.stringify(initial) || start !== String(initial.raffle.startNumber) ||
    quantity !== String(initial.raffle.quantity) || price !== priceInput(initial.raffle.unitPriceCents) ||
    date !== localDate(initial.raffle.drawAt) || scheduled !== (initial.raffle.drawAt !== null);
  useEffect(() => { onDirty(changed); }, [changed, onDirty]);
  useEffect(() => { onBusy(busy || readingImage); return () => onBusy(false); }, [busy, readingImage, onBusy]);
  const r = value.raffle;
  const field = (key: keyof typeof r, text: string) => setValue(v => ({ ...v, raffle: { ...v.raffle, [key]: text } }));
  function numeric() {
    const raffle = { ...r, startNumber: parseInteger(start), quantity: parseInteger(quantity), unitPriceCents: parsePrice(price) };
    validateRaffle({ ...raffle, name: raffle.name || 'Vista previa' });
    return raffle;
  }
  let summary: string;
  try { const n = numeric(); summary = `${n.startNumber} al ${n.startNumber + (n.quantity - 1)} · ${n.quantity} números · Potencial ${money(n.quantity * n.unitPriceCents)}`; }
  catch (e) { summary = e instanceof Error ? e.message : 'Revisá el rango y el precio.'; }
  function validateStep(index: number) {
    if (index === 0 && (!r.name.trim() || !r.publicContact.trim())) throw new Error('Completá el nombre y el contacto público.');
    if (index === 1) {
      numeric();
      if (!value.prizes.length || value.prizes.some(p => !p.description.trim())) throw new Error('Completá la descripción de cada premio.');
    }
    if (index === 2) {
      if (!r.drawMethod.trim()) throw new Error('Indicá el método y lugar del sorteo.');
      if (scheduled && (!date || !Number.isFinite(new Date(date).getTime()))) throw new Error('Elegí una fecha y hora o marcá A confirmar.');
      if (r.participants === 'todos' && !r.unsoldRule?.trim()) throw new Error('Escribí la regla para un número sin comprador.');
    }
  }
  function next() {
    try { validateStep(step); setError(''); setStep(s => s + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Revisá los datos.'); }
  }
  async function save() {
    if (busy || readingImage) return;
    try {
      for (let i = 0; i < 3; i++) validateStep(i);
      const drawAt = scheduled ? date === localDate(initial.raffle.drawAt) && initial.raffle.drawAt
        ? initial.raffle.drawAt : new Date(date).toISOString() : null;
      const input = { ...value, raffle: { ...numeric(), drawAt } };
      validateDetails(input);
      setBusy(true); setError('');
      const saved = await service.saveRaffle(input);
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el sorteo. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }
  async function readImage(file: File | undefined, target: { kind: 'logo' } | { kind: 'prize'; id: string }) {
    if (!file) return;
    setReadingImage(true); setError('');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)
        throw new Error('Elegí una imagen PNG, JPG o WebP de hasta 2 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => image.width <= 8192 && image.height <= 8192 ? resolve() : reject(new Error('La imagen debe medir como máximo 8192 píxeles por lado.'));
        image.onerror = () => reject(new Error('El archivo no contiene una imagen válida.')); image.src = data;
      });
      setValue(v => target.kind === 'logo' ? { ...v, image: data } : { ...v,
        prizes: v.prizes.map(prize => prize.id === target.id ? { ...prize, image: data } : prize) });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la imagen.'); }
    finally { setReadingImage(false); }
  }
  function movePrize(index: number, delta: number) {
    setValue(v => { const prizes = [...v.prizes]; const target = index + delta;
      if (prizes[index] && prizes[target]) [prizes[index], prizes[target]] = [prizes[target], prizes[index]];
      return { ...v, prizes }; });
  }
  const show = (index: number) => advanced || step === index;
  return <>
    <div className="page-heading"><h1>{initial.revision ? 'Editar sorteo' : 'Nuevo sorteo'}</h1></div>
    <div className="mode-bar"><span>{advanced ? 'Todos los datos a la vista' : `Paso ${step + 1} de 4`}</span>
      <button type="button" className="text-button" disabled={busy || readingImage} onClick={() => { setAdvanced(!advanced); setError(''); }}>
        {advanced ? 'Usar asistente' : 'Modo avanzado'}</button></div>
    {!advanced && <ol className="steps" aria-label="Pasos">{['Datos', 'Números', 'Reglas', 'Estilo'].map((title, i) =>
      <li key={title} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'done' : ''}>{i + 1}<span>{title}</span></li>)}</ol>}
    {value.locked && <p className="notice">Este sorteo tiene operaciones. Números, precio, premios y condiciones están protegidos. Podés cambiar el contacto y la presentación.</p>}
    <form noValidate onSubmit={e => { e.preventDefault(); if (!advanced && step < 3) next(); else void save(); }}>
      <fieldset disabled={busy || readingImage} className="form-body">
        {show(0) && <section className="form-card"><h2>La identidad de tu sorteo</h2>
          <label>Nombre del sorteo<input autoComplete="off" disabled={value.locked} value={r.name} onChange={e => field('name', e.target.value)} required /></label>
          <label>Descripción (opcional)<textarea disabled={value.locked} value={r.description} onChange={e => field('description', e.target.value)} /></label>
          <label>Organizador y contacto público<input value={r.publicContact} onChange={e => field('publicContact', e.target.value)} required /></label>
          <p className="hint">Estos datos aparecerán en el material para compartir.</p>
        </section>}
        {show(1) && <section className="form-card"><h2>Números y premios</h2>
          <fieldset disabled={value.locked}>
            <div className="field-pair"><label>Número inicial<input inputMode="text" value={start} onChange={e => setStart(e.target.value)} required /></label>
              <label>Cantidad<input inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label></div>
            <label>Precio por número (ARS)<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} aria-describedby="price-hint" required /></label>
            <p className="hint" id="price-hint">Sin separador de miles. Ejemplo: 1500,50. Podés usar 0 para un sorteo gratuito.</p>
            <output className="range-preview" aria-live="polite">{summary}</output>
          </fieldset>
          {value.prizes.map((p, i) => <div className="prize-row" key={p.id}><label>Premio {i + 1}<input disabled={value.locked} value={p.description} onChange={e => setValue(v => ({ ...v,
            prizes: v.prizes.map(item => item.id === p.id ? { ...item, description: e.target.value } : item) }))} required /></label>
            <label>Foto del premio {i + 1} (opcional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void readImage(e.target.files?.[0], { kind: 'prize', id: p.id }); e.target.value = ''; }} /></label>
            {p.image && <div className="image-preview prize-photo"><img src={p.image} alt={`Foto del premio ${i + 1}`} /><button className="text-button" type="button" onClick={() => setValue(v => ({ ...v, prizes: v.prizes.map(item => item.id === p.id ? { ...item, image: null } : item) }))}>Quitar foto del premio {i + 1}</button></div>}
            <div className="row-actions"><button type="button" className="secondary small" disabled={value.locked || i === 0} aria-label={`Subir premio ${i + 1}`} onClick={() => movePrize(i, -1)}>↑</button>
              <button type="button" className="secondary small" disabled={value.locked || i === value.prizes.length - 1} aria-label={`Bajar premio ${i + 1}`} onClick={() => movePrize(i, 1)}>↓</button>
              <button type="button" className="text-button small" disabled={value.locked || value.prizes.length === 1} onClick={() => setValue(v => ({ ...v, prizes: v.prizes.filter(item => item.id !== p.id) }))} aria-label={`Quitar premio ${i + 1}`}>Quitar</button></div></div>)}
          <button type="button" className="secondary" disabled={value.locked} onClick={() => setValue(v => ({ ...v, prizes: [...v.prizes,
            { id: crypto.randomUUID(), raffleId: r.id, position: v.prizes.length + 1, description: '', image: null }] }))}>+ Agregar premio</button>
          <p className="hint">Cada premio puede tener una foto propia. Se mostrará en una pieza de premios al generar las imágenes.</p>
        </section>}
        {show(2) && <section className="form-card"><h2>Cómo se realizará</h2><fieldset disabled={value.locked}>
          <label>Fecha del sorteo<select value={scheduled ? 'fecha' : 'confirmar'} onChange={e => setScheduled(e.target.value === 'fecha')}><option value="confirmar">A confirmar</option><option value="fecha">Fecha y hora definidas</option></select></label>
          {scheduled && <label>Fecha y hora local<input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required /></label>}
          <label>Método y lugar del sorteo<textarea placeholder="Ej.: extracción presencial en el club" value={r.drawMethod} onChange={e => field('drawMethod', e.target.value)} required /></label>
          <p className="hint">La extracción se realiza por un medio externo. Los resultados se registrarán manualmente.</p>
          <label>Participan<select value={r.participants} onChange={e => field('participants', e.target.value)}><option value="solo_vendidos">Solo números vendidos</option><option value="todos">Todos los números</option></select></label>
          {r.participants === 'todos' && <><label>Regla si sale un número sin comprador<select aria-describedby="rule-hint" value={r.unsoldRule ?? ''} onChange={e => field('unsoldRule', e.target.value)} required><option value="">Elegí la regla antes de vender</option>{r.unsoldRule && !unsoldPolicy(r.unsoldRule) && <option value={r.unsoldRule}>Regla anterior: {r.unsoldRule}</option>}<option value={unsoldRules.vacant}>Premio vacante</option><option value={unsoldRules.repeat}>Repetir extracción externa hasta un vendido</option></select></label><p id="rule-hint" className="hint">La regla se conserva al cerrar y no se cambia después de operar.</p></>}
          <p className="hint">Una reserva impaga no otorga derecho a un premio.</p>
        </fieldset></section>}
        {show(3) && <section className="form-card"><h2>La presentación</h2>
          <label>Plantilla<select value={value.template} onChange={e => setValue(v => ({ ...v, template: e.target.value as RaffleDetails['template'] }))}>
            <option value="clasica">Clásica</option><option value="moderna">Moderna</option><option value="festiva">Festiva</option>
            <option value="minimalista">Minimalista</option><option value="elegante">Elegante</option><option value="colorida">Colorida</option></select></label>
          <label>Paleta<select value={value.palette} onChange={e => setValue(v => ({ ...v, palette: e.target.value as RaffleDetails['palette'] }))}>
            <option value="bosque">Bosque · Verde y crema</option><option value="oceano">Océano · Azul y celeste</option><option value="ciruela">Ciruela · Violeta y rosa</option></select></label>
          <div className={`style-preview ${value.template} ${value.palette}`}><span>MUESTRA DE ESTILO</span><strong>{r.name || 'Tu próximo sorteo'}</strong><p>{value.prizes[0]?.description || 'Un premio para compartir'}</p><div>01 · 02 · 03</div></div>
          <label>Logo del sorteo (opcional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void readImage(e.target.files?.[0], { kind: 'logo' }); e.target.value = ''; }} /></label>
          <p className="hint">El logo aparecerá en el encabezado de las imágenes. PNG, JPG o WebP de hasta 2 MB.</p>
          {value.image && <div className="image-preview"><img src={value.image} alt="Logo del sorteo" /><button className="text-button" type="button" onClick={() => setValue(v => ({ ...v, image: null }))}>Quitar logo</button></div>}
          <div className="review-summary"><strong>{r.name || 'Tu sorteo'}</strong><p>{summary}</p><p>{scheduled ? date.replace('T', ' · ') : 'Fecha a confirmar'} · {r.participants === 'todos' ? 'Todos los números' : 'Solo vendidos'}</p></div>
          <p className="hint">Guardaremos la configuración. Después podrás generar las imágenes desde el sorteo.</p>
        </section>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {readingImage && <p role="status">Leyendo imagen…</p>}
      <div className="form-actions"><button type="button" className="secondary" disabled={busy || readingImage} onClick={onCancel}>Cancelar</button>
        {!advanced && step > 0 && <button type="button" className="secondary" disabled={busy || readingImage} onClick={() => { setStep(s => s - 1); setError(''); }}>Anterior</button>}
        <button disabled={busy || readingImage} type="submit">{busy ? 'Guardando…' : !advanced && step < 3 ? 'Continuar' : 'Guardar sorteo'}</button></div>
    </form>
  </>;
}
