import { base64 } from './signing.mjs';

const raster = new Set(['image/png', 'image/jpeg', 'image/webp']);
const inputTypes = new Set([...raster, 'application/pdf']);
const maxFileBytes = 25 * 1024 * 1024;
const $ = id => document.getElementById(id);

export function createMedia({ api, binary, notice, context, addText, changed, storedFiles }) {
  let files = [];
  const drafts = new Map();
  let restoring = false;
  let stream;
  let recognition;
  let previewUrl;
  let generation = 0;
  const thumbs = new Map();

  function clearView() {
    generation++;
    for (const url of thumbs.values()) URL.revokeObjectURL(url);
    thumbs.clear();
    if ($('media-preview').open) $('media-preview').close();
    if ($('camera-dialog').open) $('camera-dialog').close();
    stopCamera();
    recognition?.abort();
  }

  function render() {
    const { chat, profile, locked } = context();
    const allowed = chat && profile?.capabilities.includes('attachImages');
    $('attach').hidden = $('camera').hidden = !allowed;
    $('dictate').hidden = !chat || !profile?.capabilities.includes('voiceInput');
    $('attach').disabled = $('camera').disabled = locked || restoring;
    $('dictate').disabled = locked;
    $('camera').disabled ||= !navigator.mediaDevices?.getUserMedia;
    $('attachment-list').replaceChildren(...files.map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove ' + item.file.name;
      button.disabled = locked;
      button.addEventListener('click', () => { files = files.filter(other => other !== item); saveFiles(context().conversationId, files); changed(); });
      return button;
    }));
  }

  function add(file) {
    if (!inputTypes.has(file.type) || !file.size || file.size > maxFileBytes) {
      notice('Choose a PNG, JPEG, WebP, or PDF up to 25 MB.');
      return;
    }
    if (files.length >= 8) { notice('This message already has eight attachments.'); return; }
    files.push({ file, id: crypto.randomUUID() });
    saveFiles(context().conversationId, files);
    changed();
  }

  async function upload(chat) {
    const artifactIds = [];
    const snapshot = files;
    for (const item of snapshot) {
      if (!item.artifactId) {
        notice('Uploading ' + item.file.name + '…');
        const path = '/v1/conversations/' + encodeURIComponent(chat.id) + '/artifacts';
        const { artifact } = await api('POST', path, {
          filename: item.file.name, mimeType: item.file.type, audience: chat.audience,
          idempotencyKey: 'upload-' + item.id + '-' + chat.id,
          contentBase64: base64(new Uint8Array(await item.file.arrayBuffer())),
        });
        if (!/^artifact-[a-f0-9]{64}$/.test(artifact?.id)) throw new Error('attachment_upload_unconfirmed');
        item.artifactId = artifact.id;
        saveFiles(chat.id, snapshot);
      }
      artifactIds.push(item.artifactId);
    }
    return artifactIds;
  }

  function saveFiles(id, next) {
    if (id) void storedFiles(id, next).catch(() => notice('Could not save the attachment draft on this device.'));
  }

  function urlFor(artifact, chatId) {
    const base = artifact.contactId
      ? '/v1/contacts/' + encodeURIComponent(artifact.contactId) + '/sources/'
      : '/v1/conversations/' + encodeURIComponent(chatId) + '/artifacts/';
    return base + encodeURIComponent(artifact.id) + '/content';
  }

  async function preview(artifact, chatId) {
    const ticket = ++previewRevision;
    const scope = generation;
    try {
      const blob = await binary(urlFor(artifact, chatId), 26 * 1024 * 1024);
      if (ticket !== previewRevision || scope !== generation) return;
      if (artifact.mimeType && blob.type !== artifact.mimeType) throw new Error('preview_type');
      const body = $('preview-content');
      releasePreview();
      $('preview-title').textContent = artifact.filename;
      if (raster.has(blob.type)) {
        const image = new Image();
        previewUrl = URL.createObjectURL(blob);
        image.src = previewUrl;
        image.alt = artifact.filename;
        body.append(image);
      } else if (blob.type === 'application/pdf') {
        previewUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = previewUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open PDF in Chrome';
        body.append(link);
      } else if (blob.type.startsWith('text/') || ['application/json', 'image/svg+xml'].includes(blob.type)) {
        const text = await blob.slice(0, 800_000).text();
        if (ticket !== previewRevision || scope !== generation) return;
        const pre = document.createElement('pre');
        pre.textContent = text.slice(0, 200_000);
        body.append(pre);
      } else {
        body.textContent = 'A browser preview is unavailable for this file type.';
      }
      if (previewUrl) {
        const download = document.createElement('a');
        download.download = artifact.filename;
        download.href = previewUrl;
        download.textContent = 'Download';
        body.append(download);
      }
      if (!$('media-preview').open) $('media-preview').showModal();
    } catch (error) { if (ticket === previewRevision && scope === generation) notice('Could not open this output.'); }
  }

  let previewRevision = 0;
  function releasePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    $('preview-content').replaceChildren();
  }

  async function thumbnail(container, artifact, chatId) {
    const scope = generation;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumbnail';
    button.textContent = 'Open ' + artifact.filename;
    button.addEventListener('click', () => { void preview(artifact, chatId); });
    container.append(button);
    if (!raster.has(artifact.mimeType) || artifact.byteLength < 1 || artifact.byteLength > 8 * 1024 * 1024) return;
    try {
      let url = thumbs.get(artifact.id);
      if (!url && thumbs.size < 12) {
        const blob = await binary(urlFor(artifact, chatId), 8 * 1024 * 1024);
        if (scope !== generation || !button.isConnected || blob.type !== artifact.mimeType || blob.size !== artifact.byteLength) return;
        url = thumbs.get(artifact.id);
        if (!url && thumbs.size < 12) {
          url = URL.createObjectURL(blob);
          thumbs.set(artifact.id, url);
        }
      }
      if (!url) return;
      const image = new Image();
      image.src = url;
      image.alt = artifact.filename;
      button.prepend(image);
    } catch { /* The signed open action remains available. */ }
  }

  function stopCamera() {
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    $('camera-feed').srcObject = null;
    $('capture').disabled = true;
  }

  $('attach').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', () => {
    for (const file of $('file-input').files) add(file);
    $('file-input').value = '';
  });
  $('camera').addEventListener('click', async () => {
    if ($('camera-dialog').open) return;
    $('camera-status').textContent = 'Starting camera…';
    $('camera-dialog').showModal();
    const scope = generation;
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (scope !== generation || !$('camera-dialog').open) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      $('camera-feed').srcObject = stream;
      await $('camera-feed').play();
      if ($('camera-dialog').open && stream === opened) {
        $('capture').disabled = false;
        $('camera-status').textContent = '';
      }
    } catch {
      stopCamera();
      $('camera-status').textContent = 'Could not start the camera. Choose an existing photo instead.';
    }
  });
  $('capture').addEventListener('click', () => {
    const video = $('camera-feed');
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const scope = generation;
    canvas.toBlob(blob => {
      if (scope !== generation || !$('camera-dialog').open) return;
      if (blob) add(new File([blob], 'Hardy-Home-photo.jpg', { type: 'image/jpeg' }));
      $('camera-dialog').close();
    }, 'image/jpeg', .92);
  });
  $('camera-close').addEventListener('click', () => $('camera-dialog').close());
  $('camera-dialog').addEventListener('close', stopCamera);
  $('preview-close').addEventListener('click', () => $('media-preview').close());
  $('media-preview').addEventListener('close', () => { previewRevision++; releasePreview(); });

  $('dictate').addEventListener('click', async () => {
    if (recognition) { recognition.stop(); return; }
    const Speech = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const lang = navigator.language || 'en-US';
    if (!Speech?.available || !('processLocally' in Speech.prototype)) {
      notice('This Chrome version does not support on-device dictation.');
      return;
    }
    const scope = generation;
    try {
      const settings = { langs: [lang], processLocally: true };
      const available = await Speech.available(settings);
      if (scope !== generation) return;
      if (available === 'downloadable' && Speech.install) {
        notice('Installing the on-device speech language pack…');
        const installed = await Speech.install(settings);
        if (scope === generation) notice(installed ? 'Language pack ready. Select Dictate again.' : 'Could not install the local language pack.');
        return;
      }
      if (available !== 'available') { notice('The on-device speech language pack is unavailable or still downloading.'); return; }
      const session = new Speech();
      recognition = session;
      session.lang = lang;
      session.processLocally = true;
      session.onresult = event => {
        if (scope === generation) addText(event.results[0][0].transcript);
      };
      session.onerror = () => { if (scope === generation) notice('Local dictation could not finish. Check Chrome’s microphone permission.'); };
      session.onend = () => { if (recognition === session) recognition = undefined; };
      session.start();
      notice('Listening on this device…');
    } catch { recognition = undefined; notice('Could not start on-device dictation.'); }
  });

  return {
    get hasFiles() { return files.length > 0; },
    get loading() { return restoring; },
    render, upload, preview, thumbnail,
    async switchChat(previous, next) {
      if (previous) {
        if (files.length) drafts.set(previous, files);
        else drafts.delete(previous);
      }
      files = drafts.get(next) ?? [];
      clearView();
      const scope = generation;
      restoring = Boolean(next && !drafts.has(next));
      render();
      if (!restoring) return;
      try {
        const saved = await storedFiles(next);
        if (scope === generation && saved) files = saved;
      } catch {
        if (scope === generation) notice('Could not restore attachment drafts.');
      } finally {
        if (scope === generation) { restoring = false; changed(); }
      }
    },
    clearFiles(id) {
      drafts.delete(id);
      saveFiles(id, []);
      if (context().conversationId === id) { files = []; render(); }
    },
    reset() { drafts.clear(); files = []; restoring = false; clearView(); render(); },
  };
}
