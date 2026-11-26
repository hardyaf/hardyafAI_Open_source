import { createDeviceSigner } from './signing.mjs';

function defaultGoogleRedirect() {
  const host = location.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || !host.includes('.');
  return local ? 'http://localhost:8787/oauth2/callback' : location.origin + '/v1/connections/google/callback';
}
const connectionPath = /^\/v1\/connections(?:\/(?:bitwarden|password|google\/(?:config|start|complete)|connection-[a-f0-9-]+))?$/;
const sign = createDeviceSigner(path => connectionPath.test(path), 'connection_path');
const failures = {
  bitwarden_not_configured: 'Connect Bitwarden before adding an account.',
  invalid_bitwarden_project: 'Check the Bitwarden organization and project IDs.',
  bitwarden_bootstrap_already_configured: 'Bitwarden is already connected. Refresh its status.',
  credential_vault_unavailable: 'Bitwarden could not be reached or accepted. Check the machine token and project access.',
  credential_vault_outcome_unknown: 'Bitwarden has not confirmed this request. Refresh before trying again.',
  connection_reconciliation_required: 'Refresh Connections and resolve the earlier uncertain save before adding this connection again.',
  connection_operation_conflict: 'This connection request conflicts with an earlier request. Refresh its status.',
  invalid_google_client: 'Enter the complete client ID and matching client secret from the same Google OAuth Web application client.',
  invalid_google_redirect: 'Use this app’s loopback return URL or an allowed HTTPS DNS return URL.',
  google_client_not_configured: 'Complete Google setup before connecting an account.',
  google_account_mismatch: 'Google authorized a different account. Start again with the intended account.',
  google_scope_not_granted: 'Google did not grant the requested access. Start authorization again.',
  google_scope_exceeds_request: 'Google returned permissions beyond this request. Start authorization again.',
  google_authorization_expired: 'The Google authorization expired. Start again.',
  google_authorization_restart_required: 'Start Google authorization again to finish this connection.',
  google_authorization_failed: 'Google authorization could not finish. Refresh the connection status and start again.',
  google_client_credentials_rejected: 'Google rejected the OAuth client. In Google setup, use the Web application client ID and its matching client secret, then start a fresh authorization.',
  google_authorization_code_rejected: 'Google rejected this return authorization. Start a fresh authorization, then paste the complete return URL and choose Finish Google connection once.',
  google_redirect_uri_mismatch: 'The return URL does not match Google setup. Register the exact Authorized redirect URI in the OAuth web client, save the matching setup here, then start again.',
  google_consent_denied: 'Access was declined in Google. Start again and approve the requested access to connect this account.',
  google_token_exchange_unavailable: 'Google could not finish the connection right now. Start a fresh authorization when Google is reachable again.',
  google_token_exchange_failed: 'Google could not complete this authorization. Check Google setup, then start a fresh authorization.',
  google_identity_verification_unavailable: 'Google account verification could not be reached. Start a fresh authorization when Google is reachable again.',
  google_identity_verification_failed: 'The returned Google account identity did not pass verification. Check the OAuth client details, then start a fresh authorization.',
  google_grant_incomplete: 'Google did not return all details needed for this connection. Start a fresh authorization and approve the requested access.',
  google_identity_not_verified: 'Google did not verify this account email. Use a verified Google account and start a fresh authorization.',
  invalid_google_callback: 'The Google return URL could not be accepted. Paste the complete browser return URL from this authorization and choose Finish Google connection.',
  credentials_https_required: 'Open Hardy Home using its trusted HTTPS address.',
  credential_isolation_unavailable: 'The protected connection service has not passed its isolation check.',
};
const restartGoogleFailures = new Set([
  'google_client_credentials_rejected',
  'google_authorization_code_rejected',
  'google_redirect_uri_mismatch',
  'google_consent_denied',
  'google_token_exchange_unavailable',
  'google_token_exchange_failed',
  'google_identity_verification_unavailable',
  'google_identity_verification_failed',
  'google_grant_incomplete',
  'google_identity_not_verified',
  'google_authorization_expired',
  'google_authorization_restart_required',
  'google_scope_exceeds_request',
  'google_scope_not_granted',
  'google_account_mismatch',
]);
const presets = [
  ['gmail_read', 'Read Gmail'],
  ['calendar_read', 'Read a personal calendar'],
  ['household_calendar_manage', 'Manage the house calendar'],
];

// These requests intentionally never enter chat delivery, IndexedDB, or browser storage.
async function connectionRequest(identity, method, path, payload) {
  if (location.protocol !== 'https:' || !window.isSecureContext || !identity) throw new Error('secure_connection_required');
  if (!connectionPath.test(path)) throw new Error('connection_path');
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const response = await fetch(path, {
    method, body, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(45_000),
    headers: { 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...await sign(identity, method, path, body) },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error('connection_request_failed');
    error.status = response.status;
    if (Object.hasOwn(failures, result?.error)) { error.code = result.error; error.safeMessage = failures[result.error]; }
    throw error;
  }
  return result;
}

export function createConnections({ element }) {
  const launcher = document.getElementById('connections-open');
  const dialog = document.createElement('dialog');
  dialog.className = 'connections-dialog';
  dialog.setAttribute('aria-labelledby', 'connections-title');
  const title = element('h2', 'Connections');
  title.id = 'connections-title';
  const description = element('p', 'Connect an account privately. Jarvis receives a connection label and the approved account tools.', 'hint');
  const status = element('p', '', 'notice');
  status.setAttribute('role', 'status');
  const refresh = element('button', 'Refresh');
  refresh.type = 'button';
  const close = element('button', 'Close');
  close.type = 'button';
  const actions = element('div', '', 'dialog-actions');
  actions.append(refresh, close);
  const list = element('div', '', 'connections-list');
  const forms = element('div', '', 'connections-forms');
  const secure = element('fieldset');
  secure.append(element('legend', 'Add a connection'), forms);
  dialog.append(title, description, status, list, secure, actions);
  document.body.append(dialog);

  let device;
  let eligible = false;
  let snapshot;
  let pending = false;
  let generation = 0;
  let flow;
  const fields = new Set();
  const sensitive = new Set();
  const buttons = new Set();
  const operation = () => 'connection-' + crypto.randomUUID();
  const ready = () => location.protocol === 'https:' && window.isSecureContext && snapshot?.security?.ready === true;

  function field(form, label, name, { secret = false, type = 'text', required = true, maximum = 4096, hint } = {}) {
    const row = element('div', '', 'connection-field');
    const input = document.createElement('input');
    input.id = 'connection-' + name;
    input.name = name;
    input.type = secret ? 'password' : type;
    input.required = required;
    input.maxLength = maximum;
    input.autocomplete = secret ? 'new-password' : 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    const caption = element('label', label);
    caption.htmlFor = input.id;
    row.append(caption, input);
    if (hint) row.append(element('p', hint, 'hint'));
    form.append(row);
    fields.add(input);
    if (secret) sensitive.add(input);
    return input;
  }
  function section(label) {
    const details = element('details', '', 'connection-section');
    details.append(element('summary', label));
    const form = document.createElement('form');
    form.autocomplete = 'off';
    details.append(form);
    forms.append(details);
    return form;
  }
  function submit(form, label, action, needsVault = true) {
    const button = element('button', label, 'primary');
    button.type = 'submit';
    form.append(button);
    buttons.add(button);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (pending || !ready() || needsVault && !snapshot?.vault?.configured) return;
      void perform(action);
    });
    return button;
  }
  function clearSecrets() { for (const input of sensitive) input.value = ''; }
  function clearGoogleFlow() {
    flow = undefined;
    authorization.hidden = callbackForm.hidden = true;
    authorization.removeAttribute('href');
  }
  function reset() {
    clearSecrets();
    for (const input of fields) input.value = '';
    clearGoogleFlow();
  }
  function googleNextStep() {
    return (snapshot?.google?.redirectUri || redirect.value || defaultGoogleRedirect()).startsWith('http:')
      ? 'Paste the complete return URL from Google into Google return URL, then choose Finish Google connection.'
      : 'Connection status updated. Refresh after Google returns to the household page to check the connected account. If it could not finish, enter the complete return URL below and choose Finish Google connection.';
  }
  function render() {
    secure.disabled = pending || !ready();
    refresh.disabled = pending;
    for (const button of buttons) button.disabled = pending;
    passwordSave.disabled = pending || !ready() || !snapshot?.vault?.configured;
    googleSave.disabled = pending || !ready() || !snapshot?.vault?.configured;
    googleStart.disabled = pending || !ready() || !snapshot?.vault?.configured || !snapshot?.google?.configured;
    callbackSave.disabled = pending || !ready() || !flow;
    vaultNote.textContent = snapshot?.vault?.configured ? 'Bitwarden is connected. Account credentials can now be saved in its configured project.' : 'Connect a Bitwarden machine account before adding account credentials.';
    googleNote.textContent = snapshot?.google?.configured ? 'Google authorization is configured.' : 'Create an OAuth web client in your Google Cloud project and enter its client details below.';
    list.replaceChildren();
    for (const row of snapshot?.connections ?? []) {
      const card = element('article', '', 'connection-row');
      const info = element('div');
      info.append(element('strong', row.label || 'Account connection'), element('p', labelStatus(row.status), 'hint'));
      const remove = element('button', 'Disconnect');
      remove.type = 'button';
      remove.disabled = pending || !ready();
      remove.addEventListener('click', () => {
        if (!confirm('Disconnect this account from Jarvis?')) return;
        void perform(async () => {
          await call('DELETE', '/' + encodeURIComponent(row.id), { operationId: operation() });
          return 'Account disconnected.';
        });
      });
      card.append(info, remove);
      list.append(card);
    }
    if (!snapshot?.connections?.length) list.append(element('p', 'No account connections yet.', 'hint'));
  }
  function labelStatus(value) {
    return ({ connected: 'Connected', ready: 'Connected', active: 'Connected', disconnected: 'Disconnected',
      unknown: 'Needs verification', needs_attention: 'Needs attention', reconnect: 'Reconnect this account', expired: 'Authorization expired',
      error: 'Needs attention', pending: 'Waiting for authorization' })[value] ?? 'Connection saved';
  }
  async function call(method, suffix = '', body) {
    return connectionRequest(device, method, '/v1/connections' + suffix, body);
  }
  async function load() {
    const current = generation;
    const result = await call('GET');
    if (current !== generation) return;
    snapshot = result;
    if (!redirect.value) redirect.value = result.google?.redirectUri || defaultGoogleRedirect();
    renderRedirectHint();
    if (!ready()) clearSecrets();
    status.textContent = !ready()
      ? 'Secure account setup is unavailable until the protected connection service passes its isolation check.'
      : flow ? googleNextStep() : 'Connections are ready.';
    render();
  }
  async function perform(action) {
    if (!eligible || pending || !ready()) return;
    const current = generation;
    pending = true;
    status.textContent = 'Saving the connection…';
    render();
    try {
      const message = await action();
      if (current !== generation) return;
      await load();
      if (current === generation && ready()) status.textContent = message || 'Connection updated.';
    } catch (error) {
      if (current !== generation) return;
      clearSecrets();
      if (error.safeMessage) {
        if (restartGoogleFailures.has(error.code)) clearGoogleFlow();
        if (['credentials_https_required', 'credential_isolation_unavailable'].includes(error.code)) snapshot = undefined;
        status.textContent = error.safeMessage + ' Secret fields have been cleared.';
      } else if ([401, 403].includes(error.status)) {
        snapshot = undefined;
        reset();
        status.textContent = 'Only the household owner can manage account connections.';
      } else status.textContent = 'The request could not be confirmed. Refresh connection status before trying again. Secret fields have been cleared.';
    } finally {
      if (current === generation) { pending = false; render(); }
    }
  }

  const vaultForm = section('Set up Bitwarden');
  const vaultNote = element('p', '', 'hint');
  vaultForm.append(vaultNote);
  const organization = field(vaultForm, 'Organization ID', 'organizationId', { maximum: 100 });
  const project = field(vaultForm, 'Secrets Manager project ID', 'projectId', { maximum: 100 });
  const token = field(vaultForm, 'Machine account access token', 'accessToken', { secret: true, maximum: 8192 });
  submit(vaultForm, 'Connect Bitwarden', async () => {
    const body = { operationId: operation(), organizationId: organization.value.trim(), projectId: project.value.trim(), accessToken: token.value };
    token.value = '';
    await call('POST', '/bitwarden', body);
    return 'Bitwarden connection saved.';
  }, false);

  const passwordForm = section('Add a username and password');
  const passwordLabel = field(passwordForm, 'Connection label', 'passwordLabel', { maximum: 120, hint: 'Use a name Jarvis can recognize, such as House account.' });
  const origin = field(passwordForm, 'Account website', 'origin', { type: 'url', maximum: 500, hint: 'Enter the HTTPS website this account belongs to.' });
  const username = field(passwordForm, 'Username or email', 'username', { maximum: 320 });
  const password = field(passwordForm, 'Password', 'password', { secret: true, maximum: 8192 });
  const passwordSave = submit(passwordForm, 'Save account in Bitwarden', async () => {
    const url = new URL(origin.value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('account_origin');
    const body = { operationId: operation(), label: passwordLabel.value.trim(), username: username.value,
      password: password.value, origin: url.origin };
    password.value = username.value = '';
    await call('POST', '/password', body);
    passwordLabel.value = origin.value = '';
    return 'Account saved in Bitwarden.';
  });

  const googleConfig = section('Set up Google authorization');
  const googleNote = element('p', '', 'hint');
  googleConfig.append(googleNote);
  const clientId = field(googleConfig, 'Google OAuth client ID', 'clientId', { maximum: 1024 });
  const clientSecret = field(googleConfig, 'Google OAuth client secret', 'clientSecret', { secret: true, maximum: 2048 });
  const redirect = field(googleConfig, 'Authorized redirect URI', 'redirectUri', { type: 'url', maximum: 1024 });
  const redirectHint = element('p', '', 'hint');
  googleConfig.append(redirectHint);
  function renderRedirectHint() {
    redirectHint.textContent = redirect.value.startsWith('http://localhost:')
      ? 'For a household IP address, register this loopback return URL in Google. After sign-in, the browser may show an unavailable page. Return here and enter the complete browser address in the private Google return URL field.'
      : 'Register this exact HTTPS return URL in Google. An allowed DNS address can complete the connection automatically.';
  }
  redirect.addEventListener('input', renderRedirectHint);
  const googleSave = submit(googleConfig, 'Save Google setup', async () => {
    const body = { operationId: operation(), clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim(), redirectUri: redirect.value.trim() };
    clientSecret.value = '';
    await call('POST', '/google/config', body);
    clientId.value = redirect.value = '';
    return 'Google authorization setup saved.';
  });

  const googleForm = section('Connect a Google account');
  const googleLabel = field(googleForm, 'Connection label', 'googleLabel', { maximum: 120 });
  const email = field(googleForm, 'Google account email', 'expectedEmail', { type: 'email', maximum: 320 });
  const scopeLabel = element('label', 'Allowed access');
  scopeLabel.htmlFor = 'connection-preset';
  const preset = document.createElement('select');
  preset.id = 'connection-preset';
  for (const [value, text] of presets) preset.append(new Option(text, value));
  googleForm.append(scopeLabel, preset, element('p', 'Google shows the requested permissions before you approve access.', 'hint'));
  const googleStart = submit(googleForm, 'Start Google authorization', async () => {
    const result = await call('POST', '/google/start', { operationId: operation(), label: googleLabel.value.trim(), expectedEmail: email.value.trim(), preset: preset.value });
    const target = new URL(result.authorizationUrl);
    if (target.protocol !== 'https:' || target.hostname !== 'accounts.google.com' || target.username || target.password || !result.flowId) throw new Error('authorization_url');
    flow = result.flowId;
    authorization.href = target.href;
    authorization.hidden = callbackForm.hidden = false;
    googleLabel.value = email.value = '';
    return (snapshot?.google?.redirectUri || redirect.value || defaultGoogleRedirect()).startsWith('http:')
      ? 'Open Google to approve access. Then paste the complete return URL below and choose Finish Google connection.'
      : 'Open Google to approve access. Return here and refresh to check the connection.';
  });
  const authorization = element('a', 'Open Google authorization', 'connection-authorize');
  authorization.target = '_blank';
  authorization.rel = 'noopener noreferrer';
  authorization.referrerPolicy = 'no-referrer';
  authorization.hidden = true;
  googleForm.after(authorization);

  const callbackForm = document.createElement('form');
  callbackForm.autocomplete = 'off';
  callbackForm.hidden = true;
  const callback = field(callbackForm, 'Google return URL', 'callbackUrl', { secret: true, maximum: 8192,
    hint: 'After approving in Google, enter the complete return URL. It is used once to finish this connection.' });
  const callbackSave = submit(callbackForm, 'Finish Google connection', async () => {
    const body = { flowId: flow, callbackUrl: callback.value };
    callback.value = '';
    await call('POST', '/google/complete', body);
    clearGoogleFlow();
    return 'Google account connected.';
  });
  authorization.after(callbackForm);

  launcher.addEventListener('click', () => {
    if (!eligible) return;
    snapshot = undefined;
    render();
    status.textContent = 'Checking the protected connection service…';
    dialog.showModal();
    void load().catch(() => { status.textContent = 'Connections are unavailable. Check your owner access and secure connection.'; render(); });
  });
  refresh.addEventListener('click', () => {
    if (pending) return;
    snapshot = undefined;
    clearSecrets();
    render();
    status.textContent = 'Checking connection status…';
    void load().catch(() => { status.textContent = 'Could not refresh connections.'; render(); });
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearSecrets();
    else if (eligible && dialog.open && flow && !pending) {
      void load().catch(() => { status.textContent = 'Could not refresh connections.'; });
    }
  });
  window.addEventListener('pagehide', reset);
  return {
    connect(identity, profile) {
      generation++;
      device = identity;
      eligible = profile?.role === 'admin' && profile.capabilities?.includes('manageAccess');
      launcher.hidden = !eligible;
      snapshot = undefined;
      pending = false;
      reset();
      render();
    },
    disconnect() {
      generation++;
      device = undefined;
      eligible = pending = false;
      snapshot = undefined;
      launcher.hidden = true;
      if (dialog.open) dialog.close();
      reset();
      render();
    },
  };
}
