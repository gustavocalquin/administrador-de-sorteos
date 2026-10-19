const encoder = new TextEncoder();
const FORMAT = 'administrador-sorteos-backup';
const ITERATIONS = 600_000;
export const MAX_PLAIN_BYTES = 128 * 1024 * 1024;
export const MAX_FILE_BYTES = 180 * 1024 * 1024;
const aad = encoder.encode(`${FORMAT}:1:PBKDF2-SHA256:${ITERATIONS}:AES-256-GCM`);

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(parts.join(''));
}
function decode(text: unknown): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Archivo cifrado inválido.');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!password || password.length > 1024) throw new Error('Ingresá una contraseña válida.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function digest(text: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
export async function encryptBackup(plain: string, password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw new Error('Usá una contraseña de 12 a 1024 caracteres. No hay recuperación si la olvidás.');
  const bytes = encoder.encode(plain);
  if (bytes.length > MAX_PLAIN_BYTES) throw new Error('El respaldo excede el límite de 128 MB. No se exportó un respaldo parcial.');
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, await key(password, salt), bytes);
  return JSON.stringify({ format: FORMAT, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
    cipher: 'AES-256-GCM', salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(encrypted)) });
}
export async function decryptBackup(file: string, password: string): Promise<string> {
  if (file.length > MAX_FILE_BYTES) throw new Error('El archivo excede el límite permitido.');
  let envelope;
  try { envelope = JSON.parse(file); } catch { throw new Error('El archivo no es un respaldo válido.'); }
  if (!envelope || envelope.format !== FORMAT || envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== ITERATIONS || envelope.cipher !== 'AES-256-GCM') throw new Error('Formato o versión de respaldo no compatible.');
  const salt = decode(envelope.salt); const iv = decode(envelope.iv); const data = decode(envelope.data);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16 || data.length > MAX_PLAIN_BYTES + 16) throw new Error('Archivo cifrado inválido.');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, await key(password, salt), data);
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch { throw new Error('Contraseña incorrecta o respaldo dañado. Tus datos actuales siguen intactos.'); }
}
