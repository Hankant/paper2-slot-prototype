/**
 * RFC 4122 v4 UUID without assuming a secure context: crypto.randomUUID is
 * unavailable on plain-HTTP LAN origins (campus pilot), while getRandomValues
 * is also available in insecure contexts in supported browsers.
 */
export function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function')
    throw new Error('当前浏览器不支持安全随机数，请使用新版浏览器后重试');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
