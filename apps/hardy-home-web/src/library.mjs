const names = { contacts: 'Rolodex', lists: 'Lists', wiki: 'Knowledge', receipts: 'Receipts' };
const $ = id => document.getElementById(id);
import { encode as enc } from './api.mjs';

export function createLibrary({ api, element, showError, discuss, preview, stamp }) {
  let views = [];
  let view;
  let revision = 0;
  let timer;

  function action(text, handler) {
    const button = element('button', text);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function card(title, text, ...buttons) {
    const item = element('article', '', 'library-card');
    item.append(element('h3', title));
    if (text) item.append(element('p', text, 'prewrap'));
    if (buttons.length) {
      const actions = element('div', '', 'inline-actions');
      actions.append(...buttons);
      item.append(actions);
    }
    return item;
  }

  function fields(value) {
    return Object.entries(value ?? {}).map(([key, field]) =>
      key.replaceAll('_', ' ') + ': ' + (Array.isArray(field) ? field.join(', ') : field)).join('\n');
  }

  async function detail(title, loader) {
    const requested = ++revision;
    $('library-title').textContent = title;
    $('library-results').replaceChildren();
    $('library-status').textContent = 'Loading…';
    try {
      const item = await loader();
      if (revision !== requested) return;
      $('library-results').replaceChildren(action('Back to results', () => { void load(); }), item);
      $('library-status').textContent = '';
    } catch (error) {
      if (revision === requested) showError(error, 'Could not open this item.');
    }
  }

  function openContact(id) {
    void detail('Business card', async () => {
      const result = await api('GET', '/v1/contacts/' + enc(id));
      const value = result.contact;
      const name = value.fields?.full_name?.[0] || 'Scanned card';
      const item = card(name, fields(value.fields), action('Ask or correct…', () => discuss({
        kind: 'contact', id, revision: value.currentRevision ?? value.revision,
        scope: value.audience === 'household' ? 'household' : 'personal', label: name,
      }, 'About this card: ')));
      for (const source of value.sources ?? []) {
        item.append(action('Open ' + source.filename, () => preview({
          id: source.artifactId ?? source.id, contactId: id, filename: source.filename, mimeType: source.mimeType,
        })));
      }
      for (const warning of value.uncertainties ?? []) item.append(element('p', warning, 'hint'));
      for (const row of result.revisions ?? value.revisions ?? []) {
        const section = element('details');
        section.append(element('summary', 'Revision ' + row.revision + ' · ' + stamp(row.createdAt)),
          element('p', row.reason), element('p', fields(row.fields), 'prewrap'));
        item.append(section);
      }
      return item;
    });
  }

  function openWiki(id, scope) {
    void detail('Knowledge page', async () => {
      const result = await api('GET', '/v1/wiki/' + enc(id) + '?scope=' + enc(scope));
      const value = result.page ?? result;
      const title = value.title || 'Knowledge';
      const item = card(title, value.body ?? value.content, action('Discuss…', () => discuss(
        { kind: 'wiki', id, scope, label: title }, 'About this knowledge page: ')));
      for (const source of value.sources ?? []) item.append(element('p', source.title ?? source.label ?? 'Source', 'hint'));
      return item;
    });
  }

  async function rowsFor(target, query, scope) {
    switch (target) {
      case 'contacts': {
        const { contacts } = await api('GET', '/v1/contacts?query=' + enc(query) + '&limit=50');
        return contacts.map(row => card(row.fields?.full_name?.[0] || 'Scanned card',
          row.fields?.organization?.[0], action('Open card', () => openContact(row.id))));
      }
      case 'lists': {
        const { items } = await api('GET', '/v1/lists?scope=' + enc(scope));
        return items.map(row => {
          const focus = { kind: 'list_item', id: row.id, scope, label: row.text };
          return card(row.text, (row.done ? 'Done' : 'Open') + ' · ' + (row.kind || 'shopping'),
            action(row.done ? 'Reopen…' : 'Mark done…', () => discuss(focus,
              row.done ? 'Please reopen this item.' : 'Please mark this item done.')),
            action('Discuss or change…', () => discuss(focus, 'About this item: ')));
        });
      }
      case 'wiki': {
        const result = await api('GET', '/v1/wiki?scope=' + enc(scope) + '&query=' + enc(query));
        return (result.pages ?? result.results ?? []).map(row => card(row.title, row.excerpt ?? row.snippet,
          action('Open page', () => openWiki(row.id ?? row.lookup, scope))));
      }
      case 'receipts': {
        const { items } = await api('GET', '/v1/receipts/review');
        return items.map(row => card(row.title, [...(row.reasons ?? []).map(reason =>
          typeof reason === 'string' ? reason.replaceAll('_', ' ') : reason.message ?? reason.label),
          row.question].filter(Boolean).join('\n'), action('Review with Jarvis…', () => discuss(
          { kind: 'receipt', id: row.receiptId, revision: row.revision, label: row.title },
          'Please help me resolve the review for this receipt.'))));
      }
      default: return [];
    }
  }

  async function load() {
    if (!view) return;
    const requested = ++revision;
    const query = $('library-query').value.trim();
    const scope = $('library-scope').value;
    $('library-title').textContent = names[view];
    $('library-status').textContent = 'Loading…';
    $('library-results').replaceChildren();
    try {
      const rows = await rowsFor(view, query, scope);
      if (revision !== requested) return;
      $('library-results').replaceChildren(...rows);
      $('library-status').textContent = rows.length ? '' : 'No items to show.';
    } catch (error) {
      if (revision === requested) showError(error, 'This view is unavailable right now.');
    }
  }

  function open(target) {
    if (!views.includes(target)) return;
    view = target;
    $('chat-area').hidden = true;
    $('library').hidden = false;
    $('library-query-field').hidden = !['contacts', 'wiki'].includes(target);
    $('library-scope-field').hidden = !['lists', 'wiki'].includes(target);
    $('library-query').value = '';
    void load();
  }

  function close() {
    revision++;
    clearTimeout(timer);
    view = undefined;
    $('chat-area').hidden = false;
    $('library').hidden = true;
    $('library-query').value = '';
    $('library-results').replaceChildren();
    $('library-status').textContent = '';
  }

  $('library-query').addEventListener('input', () => {
    revision++;
    clearTimeout(timer);
    timer = setTimeout(() => { void load(); }, 250);
  });
  $('library-scope').addEventListener('change', () => { void load(); });
  $('library-back').addEventListener('click', close);
  $('library-refresh').addEventListener('click', () => { void load(); });

  return {
    close,
    get active() { return Boolean(view); },
    setAvailable(next) {
      views = Object.keys(names).filter(key => next.includes(key));
      $('library-tabs').replaceChildren(...views.map(key => action(names[key], () => open(key))));
      if (view && !views.includes(view)) close();
    },
  };
}
