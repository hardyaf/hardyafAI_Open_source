export function createFitbit({ api, element, stamp }) {
  const card = document.getElementById('fitbit-card');
  const status = document.getElementById('fitbit-status');
  const start = document.getElementById('fitbit-sync');
  const stop = document.getElementById('fitbit-stop');
  let enabled = false;
  let pending = false;
  let timer;
  let generation = 0;
  let snapshot;
  let requestId;
  let requestMethod;
  const phrases = {
    idle: 'Ready for a sync session.',
    starting: 'Starting your Fitbit connection…',
    running: 'Sync session running.',
    stopping: 'Finishing your sync session…',
    needs_help: 'Your Fitbit connection needs help. Ask an adult to check it.',
    unavailable: 'The Fitbit connection is unavailable. Try again later.',
  };
  function render() {
    card.hidden = !enabled;
    start.disabled = pending || ['starting','running','stopping'].includes(snapshot?.phase);
    stop.hidden = !['starting','running'].includes(snapshot?.phase);
    stop.disabled = pending;
    start.textContent = pending ? 'Please wait…' : 'Sync my Fitbit';
    if (snapshot) {
      document.getElementById('fitbit-proximity').textContent = snapshot.proximityHint;
      const details = snapshot.endsAt && ['starting','running'].includes(snapshot.phase)
        ? ' Session ends ' + stamp(snapshot.endsAt) + '.' : '';
      status.textContent = phrases[snapshot.phase] + details +
        (snapshot.phase === 'idle' && snapshot.startedAt ? ' The session ended; its last successful sync is not confirmed yet.' : '');
    }
  }
  async function refresh() {
    const current = generation;
    try {
      const result = await api('GET','/v1/fitbit');
      if (current !== generation) return;
      enabled = true; snapshot = result.fitbit; render();
    } catch (error) {
      if (current !== generation) return;
      if ([401,403,404].includes(error.status)) { enabled = false; clearTimeout(timer); }
      else if (enabled) status.textContent = 'Could not check your Fitbit connection. Try again.';
      render();
    } finally {
      if (current === generation && enabled) {
        clearTimeout(timer); timer = setTimeout(refresh, ['starting','running','stopping'].includes(snapshot?.phase) ? 5000 : 30000);
      }
    }
  }
  async function control(method) {
    if (!enabled || pending) return;
    const current = generation;
    if (!requestId || requestMethod !== method) requestId = 'fitbit-' + crypto.randomUUID();
    requestMethod = method; pending = true; render();
    try {
      const result = await api(method,'/v1/fitbit/sync',{operationId:requestId});
      if (current !== generation) return;
      snapshot = result.fitbit; requestId = requestMethod = undefined; render();
    } catch (error) {
      if (current !== generation) return;
      if (error.message === 'fitbit_radio_busy') {
        requestId = requestMethod = undefined;
        status.textContent = 'Another Fitbit is syncing. Try again when it finishes.';
      } else if (['fitbit_radio_unavailable','fitbit_not_installed'].includes(error.message)) {
        requestId = requestMethod = undefined;
        status.textContent = 'Your Fitbit connection needs help. Ask an adult to check it.';
      }
      else if (error.message === 'fitbit_operation_unconfirmed') {
        status.textContent = 'Checking the earlier sync request. Wait for the connection status before trying again.';
        requestId = requestMethod = undefined;
      } else if ([400,401,403,404,409].includes(error.status)) {
        requestId = requestMethod = undefined;
        status.textContent = 'Could not start this session. Check the connection status and try again.';
      } else status.textContent = 'The request is unconfirmed. Retrying uses the same request.';
    } finally {
      if (current === generation) { pending = false; start.disabled = ['starting','running','stopping'].includes(snapshot?.phase); stop.disabled = false; start.textContent = 'Sync my Fitbit'; }
      clearTimeout(timer); if (enabled && current === generation) timer = setTimeout(refresh,2000);
    }
  }
  start.addEventListener('click',() => { void control('POST'); });
  stop.addEventListener('click',() => { void control('DELETE'); });
  return {
    connect() { generation++; enabled = false; snapshot = undefined; requestId = requestMethod = undefined; pending = false; render(); void refresh(); },
    disconnect() { generation++; clearTimeout(timer); enabled = false; pending = false; snapshot = undefined; render(); },
    refresh,
  };
}
