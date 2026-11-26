import { base64, createDeviceSigner } from './signing.mjs';

const routes = new Set([
  '/v1/me', '/v1/conversations', '/v1/events', '/v1/presets', '/v1/household/status', '/v1/admin/diagnostics',
  '/v1/conversation-folders', '/v1/contacts', '/v1/lists', '/v1/wiki', '/v1/receipts/review', '/v1/fitbit', '/v1/fitbit/sync',
]);
const conversationRoute = /^\/v1\/conversations\/[A-Za-z0-9._%-]+(?:\/(?:messages|metadata|folder|workspace|goal|cancel|artifacts(?:\/artifact-[a-f0-9]{64}\/content)?))?$/;
const folderRoute = /^\/v1\/conversation-folders\/[A-Za-z0-9._%-]+$/;
const libraryRoute = /^\/v1\/(?:wiki\/[A-Za-z0-9._%-]+|contacts\/[A-Za-z0-9._%-]+(?:\/sources\/artifact-[a-f0-9]{64}\/content)?)$/;
const sign = createDeviceSigner(path => {
  const route = path.split('?')[0];
  return routes.has(route) || conversationRoute.test(route) || folderRoute.test(route) || libraryRoute.test(route);
});
export const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character =>
  '%' + character.charCodeAt(0).toString(16).toUpperCase());

export class RequestError extends Error {
  constructor(status, code) {
    super(code || 'request_failed');
    this.status = status;
  }
}

async function fetchSigned(identity, method, path, payload, signal) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (!identity && (path !== '/v1/enrollment/claim' || method !== 'POST')) throw new RequestError(401);
  return fetch(path, {
    method, body, signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(identity ? await sign(identity, method, path, body) : {}) },
  });
}

export async function request(identity, method, path, payload) {
  const timeout = path.endsWith('/artifacts') ? 60_000 : 18_000;
  const response = await fetchSigned(identity, method, path, payload, AbortSignal.timeout(timeout));
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new RequestError(response.status, result?.error);
  return result;
}

export async function artifactBytes(identity, path, maximum) {
  const response = await fetchSigned(identity, 'GET', path, undefined, AbortSignal.timeout(30_000));
  if (!response.ok) throw new RequestError(response.status);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (Number(response.headers.get('Content-Length')) > maximum) throw new Error('preview_too_large');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('preview_too_large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return new Blob(chunks, { type: response.headers.get('Content-Type')?.split(';')[0] });
}

export async function enroll(code) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKeyDerBase64 = base64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  const { deviceId } = await request(null, 'POST', '/v1/enrollment/claim', {
    code, deviceName: 'Hardy Home in Chrome', publicKeyDerBase64,
  });
  if (!deviceId) throw new Error('enrollment_response_invalid');
  return { deviceId, privateKey: pair.privateKey };
}

export function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hardy-home-web', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('devices')) db.createObjectStore('devices');
      if (!db.objectStoreNames.contains('delivery')) db.createObjectStore('delivery', { keyPath: ['deviceId', 'operationId'] });
      if (!db.objectStoreNames.contains('attachmentDrafts')) db.createObjectStore('attachmentDrafts');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(new Error('storage_unavailable'));
    request.onblocked = () => reject(new Error('storage_upgrade_blocked'));
  });
}

function storage(database, name, write, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(name, write ? 'readwrite' : 'readonly');
    const action = operation(transaction.objectStore(name));
    transaction.oncomplete = () => resolve(action?.result);
    transaction.onabort = transaction.onerror = () => reject(new Error('storage_unavailable'));
  });
}

export function storedIdentity(database, value) {
  const write = value !== undefined;
  return storage(database, 'devices', write, store =>
    write ? (value ? store.put(value, 'personal') : store.delete('personal')) : store.get('personal'));
}

const deviceEntries = deviceId => IDBKeyRange.bound([deviceId, ''], [deviceId, '\uffff']);

export function listDelivery(database, deviceId) {
  return storage(database, 'delivery', false, store => store.getAll(deviceEntries(deviceId)));
}

export function saveDelivery(database, deviceId, entry) {
  const { id, resource, body, operationId, consumeDraft, receipt, replaces } = entry;
  return storage(database, 'delivery', true, store => {
    if (replaces) store.delete([deviceId, replaces]);
    return store.put({ deviceId, id, resource, body, operationId, consumeDraft, receipt });
  });
}

export function clearDelivery(database, deviceId, operationId) {
  return storage(database, 'delivery', true, store => store.delete(operationId ? [deviceId, operationId] : deviceEntries(deviceId)));
}

export function attachmentDraft(database, deviceId, conversationId, files) {
  const key = [deviceId, conversationId];
  return storage(database, 'attachmentDrafts', files !== undefined, store =>
    files === undefined ? store.get(key) : files.length ? store.put(files, key) : store.delete(key));
}

export function clearAttachmentDrafts(database, deviceId) {
  return storage(database, 'attachmentDrafts', true, store => store.delete(deviceEntries(deviceId)));
}

export async function readEvents(identity, signal, onEvent, onOpen) {
  const response = await fetchSigned(identity, 'GET', '/v1/events', undefined, signal);
  if (!response.ok) throw new RequestError(response.status);
  onOpen();
  let buffer = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const lines = frame.split('\n');
      const event = lines.find(line => line.startsWith('event: '))?.slice(7);
      const data = lines.find(line => line.startsWith('data: '))?.slice(6);
      if (event && data) onEvent(event, JSON.parse(data));
    }
    if (buffer.length > 256 * 1024) throw new Error('event_frame_too_large');
  }
}
