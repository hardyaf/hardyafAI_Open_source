import { artifactBytes, attachmentDraft, clearAttachmentDrafts, clearDelivery, encode, enroll, listDelivery, openStorage, readEvents, request, saveDelivery, storedIdentity } from './api.mjs';
import { createLibrary } from './library.mjs';
import { createMedia } from './media.mjs';
import { createWorkspace } from './workspace.mjs';
import { createFitbit } from './fitbit.mjs';
import { createConnections } from './connections.mjs';
import { createSidebar } from './sidebar.mjs';

const $ = id => document.getElementById(id);
const time = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric',
  minute: '2-digit', timeZoneName: 'short',
});
const stamp = value => Number.isFinite(Date.parse(value)) ? time.format(new Date(value)) : '';
const states = {
  dispatching: 'Sending to Jarvis…', running: 'Jarvis is working…', queued: 'Message queued.',
  waiting_for_user: 'Jarvis is waiting for a reply.', complete: 'Reply received.',
  cancelled: 'Message cancelled.', failed: 'Jarvis could not finish this message.',
};
let database;
let identity;
let profile;
let conversations = [];
let selectedId;
let editingId;
let pending;
let sending = false;
let stream;
let historyRequest = 0;
let listRequest = 0;
let historyTimer;
const drafts = new Map();
const receipts = new Map();
const remembered = new Map();
const reconciled = new Set();
const retryableCodes = new Set([
  'gateway_unavailable', 'gateway_connect_timeout', 'gateway_probe_failed', 'gateway_closed',
  'gateway_unavailable_attempts_exhausted', 'household_boundary_unavailable',
  'goal_start_preflight_unavailable', 'goal_start_session_unavailable',
]);
const knownNotSent = receipt => receipt?.status === 'failed' && !receipt.recoveryRequired && retryableCodes.has(receipt.failureCode);
const failedSend = () => [...remembered.values()].find(entry =>
  entry.id === selectedId && entry.resource === 'messages' && knownNotSent(entry.receipt));

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text ?? '';
  if (className) node.className = className;
  return node;
}

const selected = () => conversations.find(chat => chat.id === selectedId);
const owned = chat => chat?.ownerProfileId === profile?.id && chat?.agentId === profile?.agentId;
const pathFor = (id, resource) => '/v1/conversations/' + encode(id) + '/' + resource;
const api = (method, path, body) => request(identity, method, path, body);
const fitbit = createFitbit({ api, element, stamp });
const connections = createConnections({ element });
const sidebar = createSidebar({
  api, element,
  context: () => ({ profile, conversations, selectedId,
    blockedDelete: id => pending?.id === id || sending && selectedId === id ||
      ['queued','dispatching','running','waiting_for_user'].includes(receipts.get(id)?.status) }),
  select,
  changed: conversationChanged,
  removed: conversationRemoved,
  folderRemoved(id) {
    listRequest++;
    conversations = conversations.map(chat => chat.folderId === id ? { ...chat, folderId: null } : chat);
    renderList();
  },
  authError: error => showError(error, 'Could not update the conversation list.'),
});
const notice = text => { $(library.active ? 'library-status' : 'status').textContent = text; };
const context = () => ({ chat: owned(selected()) ? selected() : undefined, conversationId: selectedId, profile, locked: Boolean(sending || pending) });
const media = createMedia({
  api, context, notice, changed: renderHeader,
  storedFiles: (id, files) => attachmentDraft(database, identity?.deviceId, id, files),
  binary: (path, maximum) => artifactBytes(identity, path, maximum),
  addText(text) {
    $('draft').value = [$('draft').value, text].filter(Boolean).join(' ').slice(0, $('draft').maxLength);
    drafts.set(selectedId, $('draft').value);
    renderHeader();
  },
});
const library = createLibrary({
  api, element, showError, stamp, preview: artifact => { void media.preview(artifact, selectedId); },
  discuss(item, text) {
    if (!workspace.discuss(item)) return;
    library.close();
    $('draft').value = text;
    drafts.set(selectedId, text);
    renderHeader();
    $('draft').focus();
  },
});
const workspace = createWorkspace({
  api, context, element, media, notice, showError, setViews: views => library.setAvailable(views),
  submitApproval: (questionId, decision) => {
    void prepareSend(decision === 'approve' ? 'Approve this action.' : 'Do not carry out this action.', {
      mode: 'task', replyToQuestionId: questionId, approval: { questionId, decision },
    });
  },
  control(task, action) {
    if (context().locked || !context().chat) return;
    if (['complete', 'cancel'].includes(action) &&
      !confirm(action === 'complete' ? 'Mark this goal complete?' : 'Stop this task? Completed actions stay recorded.')) return;
    const operationId = 'web-' + crypto.randomUUID();
    const target = { operationId, issuedAtMs: Date.now() };
    if (task.goalId) target.goalId = task.goalId;
    if (action === 'cancel' && task.runId) target.runId = task.runId;
    if (action !== 'cancel') target.action = action;
    pending = { id: selectedId, resource: action === 'cancel' ? 'cancel' : 'goal', operationId, body: target, consumeDraft: false };
    void sendPending();
  },
});

function renderList() { sidebar.render(); }

function conversationChanged(conversation) {
  listRequest++;
  conversations = [conversation, ...conversations.filter(chat => chat.id !== conversation.id)]
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  renderList();
  if (selectedId === conversation.id) renderHeader();
}

async function conversationRemoved(id) {
  listRequest++;
  conversations = conversations.filter(chat => chat.id !== id);
  drafts.delete(id);
  receipts.delete(id);
  media.clearFiles(id);
  const entries = [...remembered.values()].filter(entry => entry.id === id);
  for (const entry of entries) { remembered.delete(entry.operationId); reconciled.delete(entry.operationId); }
  if (selectedId === id) select(conversations[0]?.id);
  else renderList();
  try {
    await Promise.all(entries.map(entry => clearDelivery(database, identity.deviceId, entry.operationId)));
  } catch { notice('Conversation removed. Could not clear its browser delivery cache.'); }
}

function renderHeader() {
  const chat = selected();
  const writable = Boolean(chat && owned(chat));
  $('chat-title').textContent = chat?.title ?? 'Chat with Jarvis';
  $('audience').textContent = chat ? (chat.audience === 'household' ? 'Household chat' : 'Private chat') : 'Hardy Home';
  $('tags').replaceChildren(...(chat?.tags ?? []).map(tag => element('span', tag, 'tag')));
  $('edit').hidden = !writable;
  $('send-form').hidden = !writable;
  const retry = !pending ? failedSend() : null;
  const uncertain = pending?.uncertain && pending.id === selectedId;
  $('retry').hidden = !uncertain && !retry;
  $('retry').textContent = retry ? 'Retry failed send' : 'Retry same send';
  $('retry').disabled = sending;
  $('dismiss-delivery').hidden = !retry;
  $('dismiss-delivery').disabled = sending;
  $('draft').disabled = pending?.id === selectedId;
  $('send').disabled = sending || Boolean(pending) || media.loading || (!$('draft').value.trim() && !media.hasFiles);
  $('disconnect').disabled = sending;
  media.render();
  workspace.render();
}

async function loadHistory(scrollToEnd = false) {
  const id = selectedId;
  const revision = ++historyRequest;
  if (!id || !identity) return;
  try {
    const [{ messages }] = await Promise.all([api('GET', pathFor(id, 'messages')), workspace.load(id)]);
    if (historyRequest !== revision || id !== selectedId) return;
    const transcript = $('transcript');
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
    transcript.replaceChildren(...messages.filter(message => ['user', 'assistant'].includes(message.role)).map(message => {
      const card = element('article', '', 'message ' + message.role);
      const timeLabel = stamp(message.createdAt);
      const speaker = message.role === 'assistant' ? 'Jarvis' : 'Household member';
      card.append(element('small', [speaker, timeLabel].filter(Boolean).join(' · '), 'byline'), element('div', message.text));
      return card;
    }));
    const images = new Map(workspace.artifacts.filter(artifact => artifact.kind === 'output' &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mimeType)).map(artifact => [artifact.id, artifact]));
    const assistantMessages = messages.filter(message => message.role === 'assistant');
    const assistantCards = transcript.querySelectorAll('.message.assistant');
    let imageSlots = 12;
    for (let index = assistantMessages.length - 1; index >= 0 && imageSlots > 0; index--) {
      const matches = new Set(assistantMessages[index].text.match(/\bartifact-[a-f0-9]{64}\b/g) ?? []);
      for (const key of matches) {
        if (!images.has(key) || imageSlots === 0) continue;
        imageSlots--;
        void media.thumbnail(assistantCards[index], images.get(key), id);
      }
    }
    if (!transcript.childElementCount) transcript.append(element('p', 'No messages yet.', 'empty'));
    if (scrollToEnd || nearBottom) transcript.scrollTop = transcript.scrollHeight;
  } catch (error) {
    if (historyRequest === revision) showError(error, 'Could not load the conversation.');
  }
}

function showStatus() {
  const receipt = receipts.get(selectedId);
  if (pending?.uncertain) {
    notice(pending.id === selectedId
      ? 'Delivery is unconfirmed. Retrying uses the original message ID.'
      : 'A send in another conversation is awaiting confirmation.');
  } else if (failedSend()) {
    notice('The connection failed before dispatch. You can retry this message.');
  } else if (receipt?.recoveryRequired) {
    notice('Delivery needs review. Check the conversation before sending again.');
  } else {
    notice(states[receipt?.status] ?? (selected() && !owned(selected()) ? 'Shared with you. The owner can reply.' : ''));
  }
  renderHeader();
}

function select(id) {
  const previous = selectedId;
  selectedId = id;
  if (id !== previous) {
    sidebar.closeDrawer();
    library.close();
    library.setAvailable([]);
    workspace.reset();
    void media.switchChat(previous, id);
  }
  $('draft').value = drafts.get(id) ?? '';
  $('transcript').replaceChildren(element('p', id ? 'Loading messages…' : 'Choose a conversation or start a new chat.', 'empty'));
  renderList();
  showStatus();
  void loadHistory(true);
}

async function refresh() {
  const revision = ++listRequest;
  try {
    const [result] = await Promise.all([api('GET', '/v1/conversations'), sidebar.load()]);
    if (revision !== listRequest) return;
    conversations = result.conversations;
    if (!selected()) {
      select(conversations.find(chat => chat.id === pending?.id)?.id ?? conversations[0]?.id);
      return;
    }
    renderList();
    showStatus();
    await loadHistory();
  } catch (error) {
    if (revision === listRequest) showError(error, 'Could not refresh your conversations.');
  }
}

function showError(error, fallback) {
  if (error.status === 401 || error.status === 403 && error.message === 'forbidden') {
    void disconnect('Browser access expired or was revoked. Use a new invitation to reconnect.');
    return;
  }
  const target = $('conversation-dialog').open ? 'dialog-status' : library.active ? 'library-status' : profile ? 'status' : 'enroll-status';
  $(target).textContent = fallback;
}

async function disconnect(message = '') {
  fitbit.disconnect();
  connections.disconnect();
  sidebar.disconnect();
  const deviceId = identity?.deviceId;
  stream?.abort();
  clearTimeout(historyTimer);
  historyRequest++;
  listRequest++;
  identity = profile = selectedId = editingId = pending = undefined;
  conversations = [];
  drafts.clear();
  receipts.clear();
  remembered.clear();
  reconciled.clear();
  library.close();
  library.setAvailable([]);
  workspace.reset();
  media.reset();
  $('people').hidden = true;
  $('people-status').replaceChildren();
  if ($('conversation-dialog').open) $('conversation-dialog').close();
  for (const id of ['profile', 'transcript', 'conversations', 'tags', 'status']) $(id).replaceChildren();
  for (const id of ['draft', 'name', 'tag-input', 'code', 'filter']) $(id).value = '';
  $('chat-title').textContent = 'Chat with Jarvis';
  $('workspace').hidden = $('disconnect').hidden = true;
  $('enroll').hidden = false;
  $('enroll-status').textContent = message;
  if (database) {
    try {
      if (deviceId) await Promise.all([clearDelivery(database, deviceId), clearAttachmentDrafts(database, deviceId)]);
      await storedIdentity(database, null);
    }
    catch { $('enroll-status').textContent = 'Could not clear the key. Remove Hardy Home site data in Chrome to disconnect.'; }
  }
}

async function discard(entry) {
  if (pending !== entry) return;
  const deviceId = identity?.deviceId;
  pending = undefined;
  try { if (deviceId) await clearDelivery(database, deviceId, entry.operationId); }
  catch { notice('The local delivery cache could not be cleared. A retry will use the same ID.'); }
}

function accepted(entry, receipt) {
  if (pending !== entry) return;
  if (entry.consumeDraft) {
    drafts.delete(entry.id);
    media.clearFiles(entry.id);
    if (selectedId === entry.id) $('draft').value = '';
  }
  if (entry.resource === 'messages') workspace.sent(entry.id);
  pending = undefined;
  void retainReceipt(entry, receipt);
}

async function retainReceipt(entry, receipt) {
  const device = identity;
  if (!device) return;
  const key = entry.operationId;
  try {
    if (['queued', 'dispatching'].includes(receipt?.status) ||
      entry.resource === 'messages' && knownNotSent(receipt)) {
      const saved = { ...entry, consumeDraft: false, receipt, replaces: undefined };
      remembered.set(key, saved);
      await saveDelivery(database, device.deviceId, saved);
    } else {
      remembered.delete(key);
      await clearDelivery(database, device.deviceId, key);
    }
  } catch {
    notice('The local delivery cache could not be updated.');
  }
}

async function reconcileAccepted(entry, device) {
  if (reconciled.has(entry.operationId)) return;
  reconciled.add(entry.operationId);
  try {
    const response = await api('POST', pathFor(entry.id, entry.resource), entry.body);
    const receipt = response.receipt ?? response.result?.receipt;
    if (identity === device && receipt?.submissionId === entry.operationId &&
      receipt.conversationId === entry.id) recordReceipt(receipt);
  } catch { /* The durable server receipt remains authoritative. */ }
}

async function restoreDelivery() {
  const device = identity;
  if (!device || pending || sending) return;
  const saved = await listDelivery(database, device.deviceId);
  if (identity !== device || pending || sending) return;
  for (const entry of saved.filter(item => item.receipt)) {
    remembered.set(entry.operationId, entry);
    if (!receipts.has(entry.id)) receipts.set(entry.id, entry.receipt);
    if (['queued', 'dispatching'].includes(entry.receipt.status)) void reconcileAccepted(entry, device);
  }
  const entry = saved.find(item => !item.receipt);
  if (!entry) { showStatus(); return; }
  pending = { ...entry, uncertain: true, previouslyUncertain: true };
  if (entry.consumeDraft) drafts.set(entry.id, entry.body.text);
  if (conversations.some(chat => chat.id === entry.id)) select(entry.id);
  else showStatus();
}

function recordReceipt(receipt) {
  if (receipt?.profileId !== profile?.id || !receipt?.conversationId) return;
  const current = receipts.get(receipt.conversationId);
  if (current?.submissionId === receipt.submissionId &&
    ['running', 'waiting_for_user', 'complete', 'failed', 'cancelled'].includes(current.status) &&
    ['queued', 'dispatching'].includes(receipt.status)) return;
  receipts.set(receipt.conversationId, receipt);
  if (pending?.operationId === receipt.submissionId && pending.id === receipt.conversationId) {
    accepted(pending, receipt);
  } else {
    const entry = remembered.get(receipt.submissionId);
    if (entry?.id === receipt.conversationId) void retainReceipt(entry, receipt);
  }
  if (selectedId === receipt.conversationId) showStatus();
}

function eventReceived(event, data) {
  if (event === 'submission.changed') recordReceipt(data.receipt);
  const id = data.conversationId ?? data.receipt?.conversationId;
  if (id && id === selectedId) {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => { void loadHistory(); }, 250);
  }
}

async function followEvents(device, signal) {
  while (!signal.aborted) {
    try {
      await readEvents(device, signal, eventReceived, () => { void refresh(); });
    } catch (error) {
      if (signal.aborted) return;
      if (error.status === 401 || error.status === 403) {
        await disconnect('Browser access expired or was revoked. Use a new invitation to reconnect.');
        return;
      }
      notice('Live updates are reconnecting. You can refresh manually.');
    }
    await new Promise(resolve => setTimeout(resolve, 3_000));
  }
}

async function connect(device) {
  identity = device;
  const result = await api('GET', '/v1/me');
  if (!result.profile.capabilities.includes('chat')) {
    await disconnect('This profile needs chat access.');
    return;
  }
  profile = result.profile;
  $('profile').textContent = profile.displayName;
  $('enroll').hidden = true;
  $('workspace').hidden = $('disconnect').hidden = false;
  fitbit.connect();
  connections.connect(device, profile);
  sidebar.connect();
  stream?.abort();
  stream = new AbortController();
  void followEvents(device, stream.signal);
  await refresh();
  if (identity !== device) return;
  try { await restoreDelivery(); } catch { notice('Could not read saved browser delivery.'); }
  void loadOptions(device);
}

async function loadOptions(device) {
  try {
    const { presets } = await api('GET', '/v1/presets');
    if (identity !== device) return;
    const options = presets.map(preset => {
      const option = element('option', preset.label);
      option.value = preset.id;
      return option;
    });
    $('preset').replaceChildren(new Option('Default', ''), ...options);
    if (profile.capabilities.includes('viewHouseholdStatus')) {
      const { profiles } = await api('GET', '/v1/household/status');
      if (identity !== device) return;
      $('people-status').replaceChildren(...profiles.map(person => element('p', person.displayName + ' · ' + person.statusDetail)));
      $('people').hidden = false;
    }
  } catch { /* Optional profile views can be refreshed on a later connection. */ }
}

async function prepareSend(text, override) {
  const chat = selected();
  if (!text || pending || sending || media.loading || !chat || !owned(chat)) return;
  const device = identity;
  const metadata = override ?? workspace.metadata();
  sending = true;
  renderHeader();
  try {
    const artifactIds = override ? [] : await media.upload(chat);
    if (identity !== device) return;
    const operationId = 'web-' + crypto.randomUUID();
    const body = { text, submissionId: operationId, ...metadata, ...(artifactIds.length ? { artifactIds } : {}) };
    pending = { id: chat.id, resource: 'messages', body, operationId, consumeDraft: !override };
  } catch (error) {
    showError(error, 'Could not prepare the attachments. Your draft is still here.');
  } finally {
    sending = false;
    renderHeader();
  }
  if (pending) await sendPending();
}

async function sendPending() {
  if (!pending || sending) return;
  const sent = pending;
  sending = true;
  sent.uncertain = false;
  notice('Sending…');
  renderHeader();
  const device = identity;
  try {
    await saveDelivery(database, device.deviceId, sent);
    if (sent.replaces) remembered.delete(sent.replaces);
  } catch {
    sending = false;
    sent.uncertain = true;
    notice('Could not save this request in Chrome. Retry after browser storage is available.');
    renderHeader();
    return;
  }
  try {
    const response = await api('POST', pathFor(sent.id, sent.resource), sent.body);
    if (identity !== device) return;
    const receipt = response.receipt ?? response.result?.receipt;
    if (receipt) {
      if (receipt.submissionId !== sent.operationId || receipt.conversationId !== sent.id ||
        receipt.profileId !== profile?.id) throw new Error('unexpected_receipt');
      recordReceipt(receipt);
    } else if (sent.resource !== 'messages' && response.result) {
      accepted(sent);
      notice('Task control saved.');
    } else throw new Error('unexpected_receipt');
    if (selectedId === sent.id) await loadHistory(true);
  } catch (error) {
    if (pending === sent) {
      if (error.status === 401 || error.status === 403 && error.message === 'forbidden') {
        showError(error);
      } else if ([400, 403, 404, 409, 410, 422].includes(error.status) && !sent.previouslyUncertain) {
        void discard(sent);
        showError(error, 'The server rejected this request. Your draft is still here.');
      } else {
        sent.uncertain = sent.previouslyUncertain = true;
        showStatus();
      }
    }
  } finally {
    sending = false;
    renderHeader();
    if (!pending) void restoreDelivery().catch(() => notice('Could not read saved browser delivery.'));
  }
}

function openConversationDialog(chat) {
  editingId = chat?.id;
  $('dialog-title').textContent = chat ? 'Edit name and tags' : 'New conversation';
  $('name').value = chat?.title ?? '';
  $('tag-input').value = (chat?.tags ?? []).join(', ');
  $('tag-field').hidden = !chat;
  $('audience-field').hidden = Boolean(chat) || profile.role === 'child' ||
    !profile.capabilities.includes('viewHouseholdStatus');
  $('visibility').value = 'private';
  $('preset-field').hidden = Boolean(chat);
  $('preset').value = '';
  $('dialog-status').textContent = '';
  $('conversation-dialog').showModal();
}

$('conversation-form').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('name').value.trim();
  const tags = $('tag-input').value.split(',').map(tag => tag.trim()).filter(Boolean);
  if (!title || tags.length > 8 || tags.some(tag => tag.length > 32 || /\p{Cc}/u.test(tag))) {
    $('dialog-status').textContent = 'Enter a name and up to 8 tags, each 32 characters or fewer.';
    return;
  }
  $('save').disabled = $('close-dialog').disabled = true;
  try {
    const { conversation } = editingId
      ? await api('PUT', pathFor(editingId, 'metadata'), { title, tags })
      : await api('POST', '/v1/conversations', { title, audience: $('visibility').value, presetId: $('preset').value || null });
    listRequest++;
    conversations = [conversation, ...conversations.filter(row => row.id !== conversation.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $('conversation-dialog').close();
    $('filter').value = '';
    select(conversation.id);
  } catch (error) {
    showError(error, 'Could not save this conversation.');
  } finally {
    $('save').disabled = $('close-dialog').disabled = false;
  }
});

$('enroll-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('connect').disabled = true;
  $('enroll-status').textContent = 'Connecting…';
  try {
    const device = await enroll($('code').value.trim());
    $('code').value = '';
    await storedIdentity(database, device);
    await connect(device);
  } catch (error) {
    showError(error, 'Could not enroll. Check your invitation and connection.');
  } finally {
    $('connect').disabled = false;
  }
});

$('send-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('draft').value.trim() || (media.hasFiles ? 'Please review these attachments.' : '');
  void prepareSend(text);
});
$('draft').addEventListener('input', () => {
  drafts.set(selectedId, $('draft').value);
  renderHeader();
});
$('retry').addEventListener('click', () => {
  const prior = failedSend();
  if (!pending && !sending && prior) {
    const operationId = 'web-' + crypto.randomUUID();
    pending = { ...prior, operationId, body: { ...prior.body, submissionId: operationId },
      receipt: undefined, replaces: prior.operationId, consumeDraft: false };
  }
  void sendPending();
});
$('dismiss-delivery').addEventListener('click', async () => {
  const prior = failedSend();
  if (!prior || !identity) return;
  try {
    await clearDelivery(database, identity.deviceId, prior.operationId);
    remembered.delete(prior.operationId);
    showStatus();
  } catch { notice('Could not clear this delivery notice.'); }
});
$('refresh').addEventListener('click', () => { void refresh(); });
$('new').addEventListener('click', () => openConversationDialog());
$('edit').addEventListener('click', () => openConversationDialog(selected()));
$('close-dialog').addEventListener('click', () => $('conversation-dialog').close());
$('conversation-dialog').addEventListener('cancel', event => { if ($('save').disabled) event.preventDefault(); });
$('disconnect').addEventListener('click', () => {
  if (confirm('Disconnect this browser? You will need a fresh invitation to reconnect.')) void disconnect();
});
window.addEventListener('beforeunload', event => {
  if (pending) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function start() {
  if (!window.isSecureContext || !crypto.subtle) {
    $('enroll-status').textContent = 'Open Hardy Home using its private Chrome address or a trusted HTTPS connection.';
    return;
  }
  try {
    database = await openStorage();
    $('connect').disabled = false;
    const device = await storedIdentity(database);
    if (device) await connect(device);
  } catch (error) {
    showError(error, error.message === 'storage_upgrade_blocked'
      ? 'Close other Hardy Home tabs, then refresh to update browser storage.'
      : 'Could not connect to Hardy Home. Refresh to try again.');
  }
}

void start();
