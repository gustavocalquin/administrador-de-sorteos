import { useEffect, useState } from 'react';
import { normalizePhone, type BuyerInput, type BuyerRecord } from '../domain/catalog';
import type { CatalogService } from '../application/catalog-service';

export function BuyerEditor({ initial, buyers, service, onSaved, onSelect, onCancel, onDirty, onBusy }: {
  initial: BuyerRecord | null; buyers: BuyerRecord[]; service: CatalogService; onSaved: () => void;
  onSelect: (buyer: BuyerRecord) => void; onCancel: () => void; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const original: BuyerInput = { phone: initial?.phone ?? '', firstName: initial?.firstName ?? '', lastName: initial?.lastName ?? '',
    email: initial?.email ?? null, notes: initial?.notes ?? '' };
  const [value, setValue] = useState(original);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(value) !== JSON.stringify(original);
  useEffect(() => { onDirty(changed); }, [changed, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const key = normalizePhone(value.phone);
  const matches = key ? buyers.filter(b => b.id !== initial?.id && b.phoneKey.includes(key)) : [];
  const update = (field: keyof BuyerInput, text: string) => setValue(v => ({ ...v, [field]: text }));
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try { await service.saveBuyer(value, initial ?? undefined); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el comprador.'); }
    finally { setBusy(false); }
  }
  return <><h1>{initial ? 'Editar comprador' : 'Nuevo comprador'}</h1>
    <p className="intro">Una misma agenda para todos tus sorteos.</p>
    <form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="form-card">
        <label>Teléfono<input type="tel" autoComplete="tel" value={value.phone} onChange={e => update('phone', e.target.value)} required /></label>
        {matches.length > 0 && <div className="suggestions"><strong>Ya hay compradores con este teléfono</strong><p className="hint">Podés elegir uno para reutilizar su ficha o continuar para guardar otra persona. Compartir teléfono está permitido.</p>
          {matches.slice(0, 10).map(b => <button className="secondary" type="button" key={b.id} onClick={() => onSelect(b)}>Usar {b.firstName} {b.lastName}<small>{b.phone}</small></button>)}
          {matches.length > 10 && <p className="hint">Completá el teléfono para acotar las coincidencias.</p>}</div>}
        <label>Nombre<input autoComplete="given-name" value={value.firstName} onChange={e => update('firstName', e.target.value)} required /></label>
        <label>Apellido<input autoComplete="family-name" value={value.lastName} onChange={e => update('lastName', e.target.value)} required /></label>
        <label>Email (opcional)<input type="email" autoComplete="email" value={value.email ?? ''} onChange={e => update('email', e.target.value)} /></label>
        <label>Observaciones (opcional)<textarea value={value.notes} onChange={e => update('notes', e.target.value)} /></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button><button disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar comprador'}</button></div>
    </form>
  </>;
}
