const $ = id => document.getElementById(id);
const terminal = new Set(['complete', 'completed', 'cancelled', 'failed']);
const modes = {
  conversation: 'Chat', task: 'Get something done', brain_dump: 'Brain dump', diagnostic: 'Explain a problem',
};

export function createWorkspace({ api, context, element, media, notice, showError, setViews, submitApproval, control }) {
  let result;
  let mode = 'conversation';
  let linkedQuestion;
  let focus;
  let revision = 0;
  for (const [id, label] of Object.entries(modes)) {
    const option = element('option', label);
    option.value = id;
    $('mode').append(option);
  }
  $('mode').addEventListener('change', () => {
    mode = $('mode').value;
    if (mode !== 'task' && mode !== 'conversation') { linkedQuestion = undefined; focus = undefined; }
    render();
  });

  function action(text, onClick, disabled = false) {
    const button = element('button', text);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function render() {
    const { chat, profile, locked } = context();
    const task = result?.task;
    const allowTask = chat && profile?.role !== 'child';
    const isPrivate = chat?.audience === 'private';
    const diagnostic = allowTask && isPrivate && profile.capabilities.includes('viewDiagnostics');
    if (!allowTask || mode === 'diagnostic' && !diagnostic) mode = 'conversation';
    $('mode-field').hidden = !allowTask;
    $('mode').querySelector('[value=diagnostic]').hidden = !diagnostic;
    $('mode').disabled = locked;
    $('mode').value = mode;
    $('mode-note').textContent = mode === 'diagnostic' ? 'Read-only diagnosis. Jarvis can explain a problem and suggest repairs.' :
      mode === 'brain_dump' ? 'Jarvis can handle clear items and ask about uncertain ones.' : '';
    const parts = [];
    if (focus) {
      parts.push(element('p', 'Discussing ' + focus.label),
        action('Clear linked item', () => { focus = undefined; render(); }, locked));
    }
    if (task?.question && allowTask) {
      const question = task.question;
      parts.push(element('strong', question.approval ? 'Your approval is needed' : 'Jarvis has a question'),
        element('p', question.text, 'prewrap'));
      if (question.approval) {
        parts.push(action('Approve', () => submitApproval(question.id, 'approve'), locked),
          action('Decline', () => submitApproval(question.id, 'reject'), locked));
      } else {
        parts.push(action(linkedQuestion === question.id ? 'Reply linked · start a new topic' : 'Link my reply', () => {
          linkedQuestion = linkedQuestion === question.id ? undefined : question.id;
          if (linkedQuestion) { focus = undefined; mode = 'conversation'; }
          render();
        }, locked));
      }
    }
    const active = allowTask && (task?.goalId || task?.runId) && !terminal.has(task.status);
    if (task && (task.objective || task.progress?.summary || task.progress?.steps?.length || active)) {
      const details = element('details', '', 'task-progress');
      details.open = $('task-panel').querySelector('details')?.open ?? true;
      details.append(element('summary', 'Task progress · ' + (task.status || task.activity || 'idle').replaceAll('_', ' ')));
      if (task.objective) details.append(element('p', task.objective, 'prewrap'));
      if (task.progress?.summary) details.append(element('p', task.progress.summary, 'prewrap'));
      const steps = element('ol');
      for (const step of task.progress?.steps ?? []) steps.append(element('li', (step.status ?? '').replaceAll('_', ' ') + ' · ' + (step.step ?? step.text)));
      if (steps.childElementCount) details.append(steps);
      if (task.checkpointRevision != null) details.append(element('p', 'Progress saved · update ' + task.checkpointRevision, 'hint'));
      if (active) {
        const paused = task.status === 'paused' || task.phase === 'paused';
        const buttons = element('div', '', 'inline-actions');
        if (task.goalId) buttons.append(
          action(paused ? 'Resume' : 'Pause', () => control(task, paused ? 'resume' : 'pause'), locked),
          action('Finish goal', () => control(task, 'complete'), locked));
        buttons.append(action('Stop task', () => control(task, 'cancel'), locked));
        details.append(buttons);
      }
      parts.push(details);
    }
    const artifacts = result?.artifacts ?? [];
    if (artifacts.length) {
      const details = element('details');
      details.append(element('summary', 'Files and outputs (' + artifacts.length + ')'));
      const buttons = element('div', '', 'inline-actions');
      for (const artifact of artifacts) buttons.append(action(artifact.filename, () => {
        void media.preview(artifact, context().conversationId);
      }));
      details.append(buttons);
      parts.push(details);
    }
    $('task-panel').replaceChildren(...parts);
    $('task-panel').hidden = !parts.length;
  }

  async function load(conversationId) {
    const request = ++revision;
    if (!conversationId) return;
    try {
      const path = '/v1/conversations/' + encodeURIComponent(conversationId) + '/workspace';
      const next = await api('GET', path);
      if (request !== revision || context().conversationId !== conversationId) return;
      const question = next.task?.question;
      if (!question || result?.task?.question?.id !== question.id) {
        linkedQuestion = !question?.approval && !focus ? question?.id : undefined;
      }
      result = next;
      setViews(next.availableViews ?? []);
      render();
    } catch (error) {
      if (request === revision && (error.status === 401 || error.status === 403 && error.message === 'forbidden')) showError(error);
    }
  }

  function reset() {
    revision++;
    result = focus = linkedQuestion = undefined;
    mode = 'conversation';
    render();
  }

  function discuss(item) {
    const { chat, locked } = context();
    if (!chat || locked) { notice('Open a conversation you own before discussing this item.'); return false; }
    if (chat.audience === 'household' && item.scope === 'personal') {
      notice('Open a private conversation before discussing a personal item.');
      return false;
    }
    focus = item;
    linkedQuestion = undefined;
    mode = 'task';
    render();
    return true;
  }

  return {
    load, reset, render, discuss,
    get mode() { return mode; },
    get activity() { return result?.task?.activity; },
    get artifacts() { return result?.artifacts ?? []; },
    metadata() {
      const { label, ...binding } = focus ?? {};
      return { mode, ...(linkedQuestion ? { replyToQuestionId: linkedQuestion } : {}), ...(label ? { focus: binding } : {}) };
    },
    sent(conversationId) {
      if (context().conversationId === conversationId) {
        linkedQuestion = focus = undefined;
        mode = 'conversation';
        render();
      }
    },
  };
}
