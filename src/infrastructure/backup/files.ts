import { Capacitor, registerPlugin } from '@capacitor/core';
interface BackupFiles {
  exportBackup(options: { file: string }): Promise<{ cancelled: boolean; name?: string }>;
  importBackup(): Promise<{ cancelled: boolean; file?: string }>;
}
const native = registerPlugin<BackupFiles>('BackupFiles');
export const nativeBackups = Capacitor.getPlatform() === 'android';
export async function exportBackupFile(file: string): Promise<boolean> {
  if (nativeBackups) return !(await native.exportBackup({ file })).cancelled;
  if (!import.meta.env.DEV) throw new Error('La exportación requiere Android.');
  const url = URL.createObjectURL(new Blob([file], { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = `sorteos-demo-${crypto.randomUUID()}.sorteos`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // Browser download initiation cannot prove that the user saved the file.
  return false;
}
export async function importBackupFile(): Promise<string | null> {
  if (!nativeBackups) throw new Error('Usá el selector de archivo de esta demo.');
  const result = await native.importBackup(); return result.cancelled ? null : result.file ?? null;
}
