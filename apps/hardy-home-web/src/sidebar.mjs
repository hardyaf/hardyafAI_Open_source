export function createSidebar({ api, element, context, select, changed, removed, folderRemoved, authError }) {
  const $ = id => document.getElementById(id);
  const rail = $('conversation-sidebar');
  const mobile = matchMedia('(max-width: 720px)');
  let folders = [];
  let foldersReady = false;
  let active = false;
  let busy = false;
  let menu;
  let editor;
  let status = '';
  let generation = 0;
  let loadRevision = 0;
  let draggedId;
  const collapsed = new Set();
  const folderPath = id => '/v1/conversation-folders' + (id ? '/' + encodeURIComponent(id) : '');
  const chatPath = id => '/v1/conversations/' + encodeURIComponent(id);
  const owns = chat => chat.ownerProfileId === context().profile?.id && chat.agentId === context().profile?.agentId;
  const button = (text, label, action, key) => {
    const node = element('button', text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    if (key) node.dataset.focusKey = key;
    node.addEventListener('click', action);
    return node;
  };
  function drawer(open, restore = true) {
    const visible = active && mobile.matches && open;
    $('workspace').dataset.sidebarOpen = String(visible);
    $('sidebar-toggle').hidden = !active || !mobile.matches;
    $('sidebar-toggle').setAttribute('aria-expanded', String(visible));
    $('sidebar-close').hidden = !mobile.matches;
    $('sidebar-backdrop').hidden = !visible;
    rail.inert = mobile.matches && !visible;
    rail.setAttribute('aria-hidden', String(mobile.matches && !visible));
    $('chat-area').inert = visible;
    $('library').inert = visible;
    if (visible) $('sidebar-close').focus();
    else if (restore && active && mobile.matches) $('sidebar-toggle').focus();
  }
  function edit(kind, id, value = '') {
    if (busy) return;
    menu = undefined;
    editor = { kind, id, value, folderId: kind === 'chat-move' ? value : undefined,
      requestId: kind === 'folder-create' ? 'folder-' + crypto.randomUUID() : undefined, error: '' };
    render('editor-field');
  }
  function cancelEditor() {
    const previous = editor;
    editor = undefined;
    menu = undefined;
    render(previous?.id ? previous.kind.startsWith('chat-') ? 'chat-actions-' + previous.id : 'folder-actions-' + previous.id : 'new-folder');
  }
  function failure(error) {
    return ({
      conversation_active: 'Stop the task before deleting this conversation.',
      conversation_state_unavailable: 'Could not verify whether this conversation is active. Refresh before deleting it.',
      conversation_not_found: 'This conversation is no longer available. Refresh the list.',
      folder_not_found: 'This folder is no longer available. Refresh the list.',
      folder_operation_conflict: 'This folder request changed after an earlier save. Refresh the list before creating another folder.',
      invalid_folder: 'Enter a folder name of 1 to 80 characters.',
    })[error.message] ?? 'Could not confirm this change. Refresh to check the list before retrying.';
  }
  async function perform(action, focusKey) {
    if (busy || !active) return;
    const current = generation;
    busy = true;
    loadRevision++;
    if (editor) editor.error = '';
    status = '';
    render();
    try {
      await action();
      if (current !== generation) return;
      editor = menu = undefined;
    } catch (error) {
      if (current !== generation) return;
      if (error.status === 401 || error.status === 403 && error.message === 'forbidden') authError(error);
      else if (editor) editor.error = failure(error);
      else status = failure(error);
    } finally {
      if (current === generation) { loadRevision++; busy = false; render(editor ? 'editor-field' : focusKey); }
    }
  }
  function input(form, caption, value, maximum) {
    const label = element('label', caption);
    label.htmlFor = 'sidebar-editor-field';
    const node = document.createElement('input');
    node.id = 'sidebar-editor-field';
    node.dataset.focusKey = 'editor-field';
    node.value = value;
    node.maxLength = maximum;
    node.required = true;
    node.autocomplete = 'off';
    node.disabled = busy;
    node.addEventListener('input', () => { if (editor) editor.value = node.value; });
    form.append(label, node);
    return node;
  }
  function editorView(item) {
    const current = editor;
    const form = element('form', '', 'sidebar-editor');
    form.dataset.editorKind = current.kind;
    const actions = element('div', '', 'inline-actions');
    let saveLabel = 'Save';
    if (current.kind === 'chat-rename') input(form, 'Conversation name', current.value, 120);
    if (['folder-create','folder-rename'].includes(current.kind)) {
      input(form, 'Folder name', current.value, 80);
      saveLabel = current.kind === 'folder-create' ? 'Create folder' : 'Save folder name';
    }
    if (current.kind === 'chat-move') {
      const label = element('label', 'Move conversation');
      label.htmlFor = 'sidebar-editor-field';
      const choice = document.createElement('select');
      choice.id = 'sidebar-editor-field';
      choice.dataset.focusKey = 'editor-field';
      choice.setAttribute('aria-label', 'Folder for ' + item.title);
      choice.append(new Option('Unfiled', ''), ...folders.map(folder => new Option(folder.name, folder.id)));
      choice.value = current.folderId || '';
      choice.disabled = busy;
      choice.addEventListener('change', () => { if (editor) editor.folderId = choice.value; });
      form.append(label, choice);
      saveLabel = 'Save move';
    }
    if (current.kind === 'chat-delete') {
      form.append(element('p', 'Remove this conversation from the app? Previous activity is retained.'));
      saveLabel = 'Delete conversation';
    }
    if (current.kind === 'folder-delete') {
      form.append(element('p', 'Delete this folder? Conversations will return to Unfiled.'));
      saveLabel = 'Delete folder';
    }
    if (current.error) {
      const error = element('p', current.error, 'sidebar-error');
      error.setAttribute('role', 'alert');
      form.append(error);
    }
    const save = element('button', busy ? 'Saving…' : saveLabel, current.kind.endsWith('delete') ? 'danger' : 'primary');
    save.type = 'submit';
    save.disabled = busy;
    const cancel = button('Cancel', null, cancelEditor);
    cancel.disabled = busy;
    actions.append(save, cancel);
    form.append(actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (busy || editor !== current) return;
      const name = current.value?.trim();
      if (['chat-rename','folder-create','folder-rename'].includes(current.kind) &&
        (!name || /\p{Cc}/u.test(name))) {
        current.error = 'Enter a name without control characters.';
        render('editor-field');
        return;
      }
      const identity = generation;
      void perform(async () => {
        if (current.kind === 'chat-rename') {
          const { conversation } = await api('PUT', chatPath(current.id) + '/metadata', { title: name });
          if (identity === generation) changed(conversation);
        } else if (current.kind === 'chat-move') {
          const { conversation } = await api('PUT', chatPath(current.id) + '/folder', { folderId: current.folderId || null });
          if (identity === generation) { collapsed.delete(current.folderId || ''); changed(conversation); }
        } else if (current.kind === 'chat-delete') {
          await api('DELETE', chatPath(current.id));
          if (identity === generation) { await removed(current.id); status = 'Conversation removed from the app.'; }
        } else if (current.kind === 'folder-create') {
          const { folder } = await api('POST', folderPath(), { folderId: current.requestId, name });
          if (identity === generation) { folders = [...folders.filter(row => row.id !== folder.id), folder]; status = 'Folder created.'; }
        } else if (current.kind === 'folder-rename') {
          const { folder } = await api('PUT', folderPath(current.id), { name });
          if (identity === generation) folders = folders.map(row => row.id === folder.id ? folder : row);
        } else if (current.kind === 'folder-delete') {
          await api('DELETE', folderPath(current.id));
          if (identity === generation) { folders = folders.filter(row => row.id !== current.id); folderRemoved(current.id); status = 'Folder deleted. Conversations are in Unfiled.'; }
        }
      }, current.id ? (current.kind.startsWith('chat-') ? 'chat-actions-' : 'folder-actions-') + current.id : 'new-folder');
    });
    return form;
  }
  function chatRow(chat) {
    const row = element('article', '', 'conversation-row');
    row.dataset.conversationId = chat.id;
    row.draggable = foldersReady && !busy && !editor;
    row.classList.toggle('selected', chat.id === context().selectedId);
    const open = button('', null, () => {
      if (busy) return;
      menu = editor = undefined;
      select(chat.id);
      if (mobile.matches) { drawer(false, false); $('chat-title').focus(); }
    }, 'chat-open-' + chat.id);
    open.className = 'conversation';
    open.setAttribute('aria-current', String(chat.id === context().selectedId));
    const details = [chat.audience === 'household' ? 'Household' : 'Private', ...(chat.tags ?? [])];
    open.append(element('strong', chat.title), element('small', details.join(' · ')));
    const toggle = button('⋯', 'Actions for ' + chat.title, () => {
      if (busy) return;
      editor = undefined;
      menu = menu?.kind === 'chat' && menu.id === chat.id ? undefined : { kind:'chat', id:chat.id };
      render('chat-actions-' + chat.id);
    }, 'chat-actions-' + chat.id);
    toggle.className = 'row-menu-toggle';
    toggle.setAttribute('aria-expanded', String(menu?.kind === 'chat' && menu.id === chat.id));
    toggle.disabled = busy;
    row.append(open, toggle);
    if (editor?.id === chat.id && editor.kind.startsWith('chat-')) row.append(editorView(chat));
    else if (menu?.kind === 'chat' && menu.id === chat.id) {
      const actions = element('div', '', 'row-actions inline-actions');
      if (owns(chat)) actions.append(button('Rename', 'Rename ' + chat.title, () => edit('chat-rename',chat.id,chat.title)));
      const move = button('Move', 'Move ' + chat.title, () => edit('chat-move',chat.id,chat.folderId || ''));
      move.disabled = !foldersReady;
      actions.append(move);
      if (owns(chat)) {
        const remove = button('Delete', 'Delete ' + chat.title, () => edit('chat-delete',chat.id));
        remove.disabled = context().blockedDelete?.(chat.id) === true;
        actions.append(remove);
      }
      row.append(actions);
    }
    row.addEventListener('dragstart', event => {
      if (!row.draggable) { event.preventDefault(); return; }
      draggedId = chat.id;
      event.dataTransfer.setData('application/x-hardy-conversation', chat.id);
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      draggedId = undefined;
      document.querySelectorAll('.dragging,.drag-over').forEach(node => node.classList.remove('dragging','drag-over'));
    });
    return row;
  }
  async function drop(event, folderId) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const id = event.dataTransfer.getData('application/x-hardy-conversation');
    const chat = context().conversations.find(row => row.id === id);
    if (id !== draggedId || !chat || busy || !foldersReady || (chat.folderId || '') === folderId) return;
    const current = generation;
    await perform(async () => {
      const { conversation } = await api('PUT', chatPath(id) + '/folder', { folderId: folderId || null });
      if (current === generation) { collapsed.delete(folderId); changed(conversation); status = 'Conversation moved.'; }
    }, 'chat-open-' + id);
  }
  function group(folder, chats) {
    const id = folder?.id || '';
    const section = element('section', '', 'conversation-folder');
    section.dataset.folderId = id;
    const heading = element('div', '', 'folder-heading');
    const toggle = button('', (folder?.name || 'Unfiled') + ' conversations', () => {
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      render('folder-toggle-' + id);
    }, 'folder-toggle-' + id);
    toggle.className = 'folder-toggle';
    toggle.setAttribute('aria-expanded', String(!collapsed.has(id)));
    toggle.append(element('span', collapsed.has(id) ? '▸' : '▾', 'folder-arrow'), element('strong',folder?.name || 'Unfiled'), element('small',String(chats.length)));
    heading.append(toggle);
    if (folder) {
      const actions = button('⋯', 'Actions for folder ' + folder.name, () => {
        if (busy) return;
        editor = undefined;
        menu = menu?.kind === 'folder' && menu.id === id ? undefined : { kind:'folder',id };
        render('folder-actions-' + id);
      }, 'folder-actions-' + id);
      actions.className = 'row-menu-toggle';
      actions.disabled = busy;
      actions.setAttribute('aria-expanded',String(menu?.kind === 'folder' && menu.id === id));
      heading.append(actions);
    }
    section.append(heading);
    if (editor?.id === id && editor.kind.startsWith('folder-')) section.append(editorView(folder));
    else if (folder && menu?.kind === 'folder' && menu.id === id) {
      const actions = element('div', '', 'inline-actions folder-actions');
      actions.append(button('Rename folder','Rename folder ' + folder.name,() => edit('folder-rename',id,folder.name)),
        button('Delete folder','Delete folder ' + folder.name,() => edit('folder-delete',id)));
      section.append(actions);
    }
    const children = element('div', '', 'folder-conversations');
    children.hidden = collapsed.has(id);
    children.append(...chats.map(chatRow));
    if (!chats.length) children.append(element('p',folder ? 'Drag a conversation here or use Move.' : 'No unfiled conversations.','folder-empty'));
    section.append(children);
    section.addEventListener('dragover',event => {
      if (!draggedId || busy || !foldersReady) return;
      event.preventDefault();event.dataTransfer.dropEffect='move';section.classList.add('drag-over');
    });
    section.addEventListener('dragleave',event => { if (!section.contains(event.relatedTarget)) section.classList.remove('drag-over'); });
    section.addEventListener('drop',event => { void drop(event,id); });
    return section;
  }
  function render(focusKey) {
    const focused = rail.contains(document.activeElement) ? document.activeElement : null;
    const key = focusKey || focused?.dataset.focusKey;
    const selection = focused?.selectionStart === undefined ? null : [focused.selectionStart,focused.selectionEnd];
    const query = $('filter').value.trim().toLowerCase();
    const chats = context().conversations.filter(chat => [chat.title,...(chat.tags ?? [])].some(value => value.toLowerCase().includes(query)));
    const ordered = [...folders].sort((a,b) => a.name.localeCompare(b.name));
    const known = new Set(folders.map(folder => folder.id));
    const groups = [...ordered.map(folder => ({folder,chats:chats.filter(chat => chat.folderId===folder.id)})),{folder:null,chats:chats.filter(chat => !known.has(chat.folderId))}];
    $('conversations').replaceChildren(...groups.filter(value => !query || value.chats.length).map(value => group(value.folder,value.chats)));
    if (query && !chats.length) $('conversations').append(element('p','No matching conversations.','empty'));
    $('folder-controls').replaceChildren();
    if (editor?.kind === 'folder-create') $('folder-controls').append(editorView());
    else {
      const create = button('New folder',null,() => edit('folder-create',undefined,''),'new-folder');
      create.id = 'new-folder';create.disabled=busy || !foldersReady;
      $('folder-controls').append(create);
    }
    $('sidebar-status').textContent=status;
    if (key) {
      const node=rail.querySelector('[data-focus-key="'+CSS.escape(key)+'"]') || (focusKey ? rail.querySelector('.conversation[aria-current="true"]') || rail.querySelector('button') : null);
      node?.focus({preventScroll:true});
      if (focusKey === 'editor-field') node?.scrollIntoView({block:'nearest',inline:'nearest'});
      if (node?.setSelectionRange && selection && !focusKey) node.setSelectionRange(...selection);
    }
  }
  async function load() {
    const current=generation,revision=++loadRevision;
    try {
      const result=await api('GET',folderPath());
      if (current!==generation || revision!==loadRevision) return;
      folders=result.folders;foldersReady=true;render();
    } catch (error) {
      if (current!==generation || revision!==loadRevision) return;
      if (error.status===401 || error.status===403 && error.message==='forbidden') authError(error);
      else { foldersReady=false;status='Could not load folders. Refresh to try again.';render(); }
    }
  }
  $('filter').addEventListener('input',() => render());
  $('sidebar-toggle').addEventListener('click',() => drawer($('workspace').dataset.sidebarOpen!=='true'));
  $('sidebar-close').addEventListener('click',() => drawer(false));
  $('sidebar-backdrop').addEventListener('click',() => drawer(false));
  rail.addEventListener('keydown',event => {
    if (event.key==='Escape') {
      if (busy) return;
      event.preventDefault();
      if (editor) cancelEditor();
      else if (menu) { const key=(menu.kind==='chat'?'chat-actions-':'folder-actions-')+menu.id;menu=undefined;render(key); }
      else if (mobile.matches) drawer(false);
    }
    if (event.key==='Tab' && mobile.matches && $('workspace').dataset.sidebarOpen==='true') {
      const nodes=[...rail.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(node => node.getClientRects().length);
      if (event.shiftKey && document.activeElement===nodes[0]) { event.preventDefault();nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement===nodes.at(-1)) { event.preventDefault();nodes[0]?.focus(); }
    }
  });
  $('library-tabs').addEventListener('click',event => {
    if (mobile.matches && event.target.closest('button') && !$('library').hidden) {
      drawer(false,false);
      $('library-title').focus();
    }
  });
  $('connections-open').addEventListener('click',() => { if (mobile.matches) drawer(false,false); });
  mobile.addEventListener('change',() => drawer(false,false));
  return {
    render,load,
    closeDrawer() { drawer(false,false); },
    connect() { generation++;active=true;folders=[];foldersReady=false;menu=editor=undefined;status='';busy=false;drawer(false,false);render(); },
    disconnect() { generation++;loadRevision++;active=false;folders=[];foldersReady=false;menu=editor=undefined;status='';busy=false;drawer(false,false);render(); },
  };
}
