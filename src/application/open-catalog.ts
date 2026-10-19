import { Capacitor } from '@capacitor/core';
import { openNativeDatabase } from '../infrastructure/database/native';
import { CatalogService } from './catalog-service';

let pending: Promise<CatalogService> | undefined;
export function openCatalog(): Promise<CatalogService> {
  pending ??= (async () => {
    if (Capacitor.getPlatform() === 'android') return new CatalogService(await openNativeDatabase(), 'android');
    if (import.meta.env.DEV) {
      const { openBrowserDatabase } = await import('../dev/browser-database');
      return new CatalogService(await openBrowserDatabase(), 'preview');
    }
    throw new Error('Instalá la aplicación Android para guardar tus datos.');
  })().catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}
