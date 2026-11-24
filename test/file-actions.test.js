const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const actions = source.slice(source.indexOf('function focusFileRow('), source.indexOf('function renderFileTree('));

function fixture({ name = 'renamed.tex', confirm = true, active = 'Sections/main.tex' } = {}) {
  const calls = [];
  const state = {
    activeProject: { id: 'test' }, activePath: active, selectedPath: active,
    mainDocument: active, collapsedFolders: new Set(['Sections']), dirty: false,
    files: [{ path: 'Sections', type: 'directory' }, { path: active, type: 'file', editable: true }],
  };
  const tree = { querySelectorAll: () => [], focus() {} };
  const context = vm.createContext({
    state, elements: { fileTree: tree },
    window: { prompt: () => name, confirm: () => confirm },
    parentDirectory: value => value.split('/').slice(0, -1).join('/'),
    showToast: (...args) => calls.push(['toast', ...args]),
    saveFile: async () => { calls.push(['save']); return true; },
    stopDocumentCollaboration: () => calls.push(['stop']),
    startDocumentCollaboration: async () => true,
    codeEditor: { setReadOnly() {} },
    api: async (url, options) => {
      calls.push(['api', url, options]);
      if (url.endsWith('/rename')) {
        const { from, to } = JSON.parse(options.body);
        state.files = state.files.map(file => ({ ...file,
          path: file.path === from || file.path.startsWith(from + '/') ? to + file.path.slice(from.length) : file.path,
        }));
      }
    },
    resetEditorState: () => { state.activePath = null; calls.push(['reset']); },
    refreshFiles: async () => {},
    setMainDocument: async value => { state.mainDocument = value; },
    openFile: async file => { state.activePath = file.path; calls.push(['open', file.path]); },
  });
  vm.runInContext(actions, context);
  return { context, state, calls, tree };
}

test('rename of an open folder remaps its document and compilation target', async () => {
  const { context, state, calls } = fixture({ name: 'Chapters' });
  state.dirty = true;
  await context.performFileAction('rename', state.files[0]);
  assert.equal(state.activePath, 'Chapters/main.tex');
  assert.equal(state.mainDocument, 'Chapters/main.tex');
  assert.ok(state.collapsedFolders.has('Chapters'));
  assert.ok(calls.findIndex(call => call[0] === 'save') < calls.findIndex(call => call[0] === 'api'));
});

test('delete operates on the requested row and preserves an unrelated editor', async () => {
  const { context, state, calls } = fixture();
  await context.performFileAction('delete', { path: 'Sections-old', type: 'directory' });
  assert.equal(state.activePath, 'Sections/main.tex');
  assert.ok(!calls.some(call => call[0] === 'reset'));
  assert.equal(calls.find(call => call[0] === 'api')[1], '/api/file?path=Sections-old');
});

test('cancelled deletion and invalid or conflicting names do not mutate files', async () => {
  for (const options of [{ confirm: false }, { name: '../escape' }, { name: 'Sections' }]) {
    const { context, state, calls } = fixture(options);
    await context.performFileAction(options.confirm === false ? 'delete' : 'rename', state.files[0]);
    assert.ok(!calls.some(call => call[0] === 'api'));
  }
});

test('context menu and tree-only shortcuts dispatch the target file', async () => {
  const { context, tree, state } = fixture();
  const handlers = new Map();
  const selected = [];
  let focused;
  class Element {
    constructor() { this.children = []; this.handlers = {}; this.style = {}; this.offsetWidth = 190; this.offsetHeight = 80; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    querySelector() { return this.children[0]; }
    querySelectorAll() { return this.children; }
    focus() { focused = this; }
    contains(element) { return this.children.includes(element); }
  }
  const body = new Element();
  context.document = { body, createElement: () => new Element(), addEventListener() {} };
  Object.assign(context.window, { innerWidth: 800, innerHeight: 600, addEventListener() {} });
  tree.addEventListener = (name, handler) => handlers.set(name, handler);
  context.performFileAction = (action, file) => selected.push([action, file.path]);
  context.initializeFileActions();
  const row = { dataset: { path: state.files[1].path }, focus() {}, getBoundingClientRect: () => ({ left: 10, bottom: 20 }) };
  const event = { target: { closest: () => row }, preventDefault() {}, stopPropagation() {}, clientX: 790, clientY: 590 };
  handlers.get('contextmenu')(event);
  const menu = body.children[0];
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.left, '606px');
  assert.equal(focused, menu.children[0]);
  menu.children[0].handlers.click();
  assert.equal(menu.hidden, true);
  handlers.get('keydown')({ ...event, key: 'Delete' });
  handlers.get('keydown')({ ...event, key: 'Backspace', metaKey: true });
  handlers.get('keydown')({ ...event, key: 'F2' });
  handlers.get('keydown')({ ...event, key: 'Delete', repeat: true });
  handlers.get('keydown')({ ...event, key: 'Delete', ctrlKey: true });
  assert.deepEqual(selected, [['create', row.dataset.path], ['delete', row.dataset.path], ['delete', row.dataset.path], ['rename', row.dataset.path]]);
});
