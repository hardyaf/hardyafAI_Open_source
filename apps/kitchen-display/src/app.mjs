import { base64, signedHeaders } from './signing.mjs';

const $ = (id) => document.getElementById(id);
const MAX_STALE = 10 * 60 * 1000;
let identity = null;
let generation = 0;
let controller = null;
let polling = null;
let snapshotAt = 0;
let publicationUrl = null;
let publicationId = null;
let publicationReady = false;
let inFlight = false;
let database;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = String(text);
  if (className) result.className = className;
  return result;
}
function notice(message, mode = '') {
  $('connection').textContent = message;
  $('connection').dataset.mode = mode;
}
function resetPublication() {
  $('publication-body').replaceChildren();
  $('publication').hidden = true;
  if (publicationUrl) URL.revokeObjectURL(publicationUrl);
  publicationUrl = null; publicationId = null; publicationReady = false;
}
function clearProjection() {
  $('lists').replaceChildren(); $('events').replaceChildren(); $('notices').replaceChildren();
  resetPublication(); snapshotAt = 0; $('updated').textContent = '';
}

async function openDatabase() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open('hardy-household-device', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('identity');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('storage_unavailable'));
  });
}
async function storedIdentity(value) {
  const write = arguments.length > 0;
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction('identity', write ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('identity');
    const request = write ? (value ? store.put(value, 'display') : store.delete('display')) : store.get('display');
    let result;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(new Error('storage_unavailable'));
  });
}

async function boundedBytes(response, maximum) {
  if (Number(response.headers.get('Content-Length')) > maximum) throw new Error('content_too_large');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error('content_too_large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function request(path, signal, maximum = 1024 * 1024) {
  const headers = await signedHeaders(identity, 'GET', path);
  const response = await fetch(path, { headers, signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (response.status === 401 || response.status === 403) throw new Error('display_revoked');
  if (!response.ok) throw new Error('connection_unavailable');
  return { bytes: await boundedBytes(response, maximum), mime: response.headers.get('Content-Type')?.split(';')[0] ?? '' };
}

function renderLists(values) {
  const cards = [];
  for (const list of Array.isArray(values) ? values : []) {
    const card = node('article', undefined, 'card'); card.append(node('h2', list.title || 'Household list'));
    const items = node('ul');
    for (const item of Array.isArray(list.items) ? list.items : []) {
      const row = node('li', `${item.done ? '✓' : '○'} ${item.text || ''}`); if(item.done) row.className = 'done'; items.append(row);
    }
    if (!items.children.length) card.append(node('p', 'Nothing on this list yet.', 'muted')); else card.append(items);
    cards.push(card);
  }
  if (!cards.length) cards.push(node('p', 'No household lists have been shared yet.', 'empty'));
  $('lists').replaceChildren(...cards);
}
function formatEventDate(value, allDay = false) {
  if (!value) return '';
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year,month,day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday:'short',month:'short',day:'numeric' }).format(new Date(year,month-1,day));
  }
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return 'Time to be confirmed';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function renderEvents(values) {
  const cards = [];
  for (const event of Array.isArray(values) ? values : []) {
    const card = node('article', undefined, 'event'); card.append(node('h3', event.title || 'Household event'), node('p', formatEventDate(event.start,event.allDay), 'muted'));
    if (event.allDay) card.append(node('p', 'All day', 'muted'));
    else if (event.end) card.append(node('p', `Until ${formatEventDate(event.end)}`, 'muted'));
    cards.push(card);
  }
  if(!cards.length) cards.push(node('p', 'No upcoming household events to display.', 'empty'));
  $('events').replaceChildren(...cards);
}

/** Inert local document only. Remove navigation/active elements before sandbox rendering. */
function inertHtml(text) {
  const parsed = new DOMParser().parseFromString(text, 'text/html');
  parsed.querySelectorAll('script,meta,base,link,iframe,frame,object,embed,form,input,button,textarea,select,audio,video,source,track,foreignObject,animate,animateMotion,animateTransform,set').forEach((element) => element.remove());
  parsed.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['href', 'xlink:href', 'action', 'formaction', 'srcset', 'ping', 'target'].includes(name) || (name === 'src' && !/^data:image\/(png|jpeg|webp);base64,/i.test(attribute.value))) element.removeAttribute(attribute.name);
    }
  });
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>body{margin:16px;font:20px system-ui;color:#172b36;background:white}img,svg{max-width:100%;height:auto}</style>${parsed.head.innerHTML}</head><body>${parsed.body.innerHTML}</body></html>`;
}

async function renderPublication(publication, token, signal) {
  if (!publication || typeof publication.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(publication.id)) { resetPublication(); return; }
  if(publication.id === publicationId && publicationReady) return;
  resetPublication(); publicationId = publication.id;
  $('publication').hidden = false; $('publication-title').textContent = publication.title || 'Shared output';
  $('publication-body').replaceChildren(node('p', 'Loading shared output…', 'muted'));
  try {
    const path = `/v1/display/publications/${encodeURIComponent(publication.id)}/content`;
    const content = await request(path, signal, 26 * 1024 * 1024);
    if(token !== generation) return;
    const mime = content.mime || publication.mimeType;
    let preview;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(mime)) {
      publicationUrl = URL.createObjectURL(new Blob([content.bytes], { type: mime }));
      preview = node('img'); preview.src = publicationUrl; preview.alt = publication.title || 'Published household visual';
    } else if(mime === 'text/html') {
      preview = node('iframe'); preview.setAttribute('sandbox', ''); preview.setAttribute('referrerpolicy', 'no-referrer');
      preview.title = publication.title || 'Shared output'; preview.tabIndex = -1;
      preview.srcdoc = inertHtml(new TextDecoder().decode(content.bytes));
    } else if(mime.startsWith('text/') || mime === 'application/json') preview = node('pre', new TextDecoder().decode(content.bytes).slice(0, 200000));
    else if (mime === 'application/pdf') {
      publicationUrl = URL.createObjectURL(new Blob([content.bytes], { type: mime }));
      preview = node('iframe'); preview.setAttribute('sandbox', ''); preview.title = publication.title || 'Shared document'; preview.src = publicationUrl;
    } else preview = node('p', 'This published document cannot be previewed on the kitchen screen.', 'muted');
    $('publication-body').replaceChildren(preview); publicationReady = true;
  } catch(error) {
    if(token !== generation || signal.aborted) return;
    if(error.message === 'display_revoked') throw error;
    publicationReady = false; $('publication-body').replaceChildren(node('p', 'This shared output is temporarily unavailable. Retrying…', 'muted'));
  }
}

async function poll() {
  if(inFlight || !identity?.deviceId) return;
  inFlight = true; const token = generation;
  controller = new AbortController(); const currentController = controller; const signal = currentController.signal;
  const timeout = setTimeout(() => currentController.abort(), 12000);
  try {
    const content = await request('/v1/display/snapshot', signal);
    const snapshot = JSON.parse(new TextDecoder().decode(content.bytes));
    if(token !== generation) return;
    const listProjection = snapshot.householdLists;
    const calendarProjection = snapshot.upcomingEvents;
    const lists = snapshot.lists || (listProjection ? [
      {title:'Shopping',items:listProjection.shopping}, {title:'Tasks',items:listProjection.tasks}, {title:'Waiting',items:listProjection.waiting},
    ] : []);
    renderLists(lists); renderEvents(snapshot.events || calendarProjection?.events);
    const notices = Array.isArray(snapshot.notices) ? [...snapshot.notices] : [];
    if(listProjection?.status === 'unavailable') { $('lists').replaceChildren(node('p','Household lists are unavailable right now.','empty')); notices.push('Household lists could not be refreshed.'); }
    if(calendarProjection?.status === 'unavailable') { $('events').replaceChildren(node('p','Household calendar connection is unavailable.','empty')); notices.push('The household calendar connection needs attention.'); }
    if(snapshot.publicationStatus === 'unavailable') notices.push('Shared outputs are temporarily unavailable.');
    $('notices').replaceChildren(...notices.map((value) => node('p', typeof value === 'string' ? value : value.message || '', 'notice')));
    snapshotAt = Date.now(); $('updated').textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(snapshotAt)}`;
    notice('Connected to your household', 'online');
    await renderPublication(snapshot.publicationStatus === 'unavailable' ? null : snapshot.publication || snapshot.publications?.[0], token, signal);
  } catch(error) {
    if(token !== generation) return;
    if(error.message === 'display_revoked') { await disconnect(true); return; }
    notice(snapshotAt ? 'Connection lost · showing the last household update' : 'Connecting to your household…', snapshotAt ? 'stale' : 'offline');
  } finally {
    clearTimeout(timeout);
    if(token === generation) inFlight = false;
  }
}

function connect() {
  $('enrollment').hidden = true; $('household').hidden = false; $('disconnect').hidden = false;
  notice('Loading your household…'); poll();
  clearInterval(polling); polling = setInterval(() => {
    if(snapshotAt && Date.now() - snapshotAt > MAX_STALE) { clearProjection(); notice('Offline · waiting for a fresh household update', 'offline'); }
    poll();
  }, 15000);
}
async function disconnect(revoked = false) {
  generation += 1; controller?.abort(); clearInterval(polling); polling = null; inFlight = false;
  clearProjection(); identity = null;
  await storedIdentity(null).catch(() => {});
  $('household').hidden = true; $('enrollment').hidden = false; $('disconnect').hidden = true;
  $('enrollment-notice').textContent = revoked ? 'This screen has been disconnected. Ask for a new kitchen-display invitation to reconnect.' : 'This screen has been disconnected.';
  notice(revoked ? 'Access removed' : 'Not connected', 'offline');
}

$('enrollment-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('enroll-button'); button.disabled = true;
  $('enrollment-notice').textContent = 'Connecting this screen…';
  const token = generation;
  try {
    const code = $('code').value.trim(); const deviceName = $('device-name').value.trim();
    if(code.length < 8 || !deviceName) throw new Error('invitation_needed');
    if(!identity?.privateKey || !identity?.publicKey) {
      const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify']);
      identity = {privateKey:pair.privateKey,publicKey:pair.publicKey}; await storedIdentity(identity);
    }
    const publicKeyDerBase64 = base64(new Uint8Array(await crypto.subtle.exportKey('spki', identity.publicKey)));
    const result = await fetch('/v1/display/enrollment/claim', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code,deviceName,publicKeyDerBase64}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    if(!result.ok) throw new Error(result.status >= 500 ? 'connection_unavailable' : 'invitation_needed');
    const response = JSON.parse(new TextDecoder().decode(await boundedBytes(result, 64*1024)));
    if(token !== generation) return;
    if(typeof response.deviceId !== 'string' || !response.deviceId) throw new Error('connection_unavailable');
    identity.deviceId = response.deviceId; await storedIdentity(identity); $('code').value = ''; connect();
  } catch(error) {
    if(token !== generation) return;
    $('enrollment-notice').textContent = error.message === 'invitation_needed' ? 'Enter a complete, unused kitchen-display invitation. Phone invitations cannot connect a kitchen screen.' : 'Could not connect this screen. Check the household connection and try again.';
  } finally { button.disabled = false; }
});
$('disconnect').addEventListener('click', () => { if(confirm('Disconnect this kitchen screen and remove its local connection?')) disconnect(); });
window.addEventListener('online', poll);
document.addEventListener('visibilitychange', () => { if(!document.hidden) poll(); });
window.addEventListener('pagehide', () => { controller?.abort(); if(publicationUrl) URL.revokeObjectURL(publicationUrl); });

async function start() {
  if (!window.isSecureContext || !crypto.subtle) {
    notice('Secure household address required', 'offline');
    $('enrollment-notice').textContent = 'Open the HTTPS household display address, or use the local screen connection on this machine. Device keys need a secure browser connection.';
    $('enroll-button').disabled = true; return;
  }
  try {
    database = await openDatabase(); identity = await storedIdentity();
    if(identity?.deviceId && identity?.privateKey) connect(); else notice('Connect your kitchen screen');
  } catch {
    notice('Browser storage unavailable', 'offline'); $('enrollment-notice').textContent = 'Allow storage for this household display, then reload. Private browsing cannot keep this screen enrolled.'; $('enroll-button').disabled = true;
  }
}
start();
