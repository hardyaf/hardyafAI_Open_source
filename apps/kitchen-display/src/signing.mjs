const encoder = new TextEncoder();

export function base64(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}

/** WebCrypto emits IEEE P1363 r||s; the existing device verifier accepts ASN.1 DER. */
export function p1363ToDer(value) {
  const bytes = new Uint8Array(value);
  if (bytes.length !== 64) throw new Error('signature_format');
  const integer = (part) => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start += 1;
    const result = Array.from(part.subarray(start));
    if (result[0] & 0x80) result.unshift(0);
    return [2, result.length, ...result];
  };
  const body = [...integer(bytes.subarray(0, 32)), ...integer(bytes.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

const isDisplayPath = path => path.startsWith('/v1/display/') && !/[\r\n]/.test(path);

async function encodeRequest(method, path, timestamp, nonce, body) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  return [method.toUpperCase(), path, timestamp, nonce, Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')].join('\n');
}

export async function canonicalRequest(method, path, timestamp, nonce, body = '') {
  if (!isDisplayPath(path)) throw new Error('display_path');
  return encodeRequest(method, path, timestamp, nonce, body);
}

export function createDeviceSigner(allowedPath, errorCode = 'request_path') {
  return async (identity, method, path, body = '') => {
    if (!path.startsWith('/v1/') || /[\r\n]/.test(path) || !allowedPath(path)) throw new Error(errorCode);
    const timestamp = Date.now().toString();
    const nonce = 'nonce-' + crypto.randomUUID();
    const canonical = await encodeRequest(method, path, timestamp, nonce, body);
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, encoder.encode(canonical));
    return {
      'X-Hardy-Device-Id': identity.deviceId,
      'X-Hardy-Timestamp': timestamp,
      'X-Hardy-Nonce': nonce,
      'X-Hardy-Signature': base64(p1363ToDer(signature)),
    };
  };
}

export const signedHeaders = createDeviceSigner(isDisplayPath, 'display_path');
