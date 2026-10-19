import { Capacitor, registerPlugin } from '@capacitor/core';
import type { GraphicImage } from '../../domain/graphics';

interface NativeImages {
  share(options: { images: { dataUrl: string }[] }): Promise<{ opened: boolean }>;
  exportImages(options: { images: { dataUrl: string }[] }): Promise<{ cancelled: boolean; count?: number }>;
}
const native = registerPlugin<NativeImages>('PublicImages');
export async function sendImages(images: GraphicImage[], action: 'share' | 'export'): Promise<string> {
  if (!images.length) throw new Error('Seleccioná al menos una pieza.');
  if (Capacitor.getPlatform() !== 'android') throw new Error('Compartir y exportar el conjunto usan Android. En esta demo podés descargar cada PNG desde su vista previa.');
  const payload = { images: images.map(p => ({ dataUrl: p.dataUrl })) };
  if (action === 'share') { await native.share(payload); return 'Selector de Android abierto. La app de destino decide cómo recibir las imágenes.'; }
  const result = await native.exportImages(payload);
  return result.cancelled ? 'Exportación cancelada. No se guardaron archivos.' : `${result.count} imágenes exportadas a la carpeta elegida.`;
}
