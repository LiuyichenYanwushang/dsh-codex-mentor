import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
test('published GUI artifact matches the tested authored lazy module', async () => {
  const artifact = await readFile(new URL('../gui/client.js', import.meta.url), 'utf8');
  assert.equal(artifact, source.replaceAll('dsh-codex-mentor', 'dsh-codex-mentor-gui'));
});
const sample = () => ({
  project: { id: 'p1', name: 'Project one' },
  memories: [{ id: 'm1', revision: 4, scope: 'project', memberId: null, conclusion: 'Verified conclusion', evidence: 'observed test', conditions: 'version one', status: 'confirmed', author: 'leader', updatedAt: '2026-10-06' }],
  members: [{ id: 'logical-1', description: 'Research', incarnations: [{ nativeName: 'worker-old' }], current: { nativeName: 'worker-current', childSessionId: 'child-1', availability: 'available', taskId: 'task-1', status: 'idle' } }],
  discussions: [{ id: 'd1', revision: 2, topic: 'Current discussion', participants: ['worker-current'], canPost: true, maxRounds: 3, round: 1, status: 'open', posts: [{ id: 'post-1', author: 'leader', memberId: null, round: 1, text: 'First post' }], conclusion: '', dissent: '' }],
  permissions: { canEditMemory: true, canDiscuss: true, canLeadDiscussion: true }, nextOffset: null,
});
const success = value => ({ ok: true, value });
test('GUI revision reaches the real native memory validator without immutable identity fields', async () => {
  const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
  registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
  const { Context } = await import('@deepseek-ai/cordis');
  const { openProjectMemory } = await import('../project-memory.js');
  const temp = await mkdtemp(join(tmpdir(), 'mentor-client-memory-')); const ctx = new Context(); let memory;
  try {
    for (const [name, config] of [['dsh-storage', {}], ['dsh-storage-json', { root: temp }], ['dsh-storage-domain', { backend: 'json' }]]) {
      const mod = await import('@deepseek-ai/' + name); await ctx.plugin(mod.default ?? mod, config);
    }
    memory = await openProjectMemory(ctx.storageDomain);
    const authority = { projectId: 'owned-ui-fixture', memberId: 'leader', role: 'user', sessionId: 'root' };
    const record = await memory.mutate(authority, { action: 'note', conclusion: 'Original full note', evidence: 'Native fixture' });
    const data = sample(); data.memories = [record];
    const app = await setup({ snapshotCall: () => success({ ...data, memories: [memory.read(authority, record.id)] }), memoryCall: async (_id, request) => success({ memory: await memory.mutate(authority, request) }) });
    await app.open(); await app.click('修订'); app.change('结论', 'Revised through native validator'); await app.submit('保存');
    const revised = memory.read(authority, record.id); assert.equal(revised.conclusion, 'Revised through native validator'); assert.equal(revised.revision, 2);
    app.dispose();
  } finally {
    await memory?.close(); await ctx.fiber.dispose(); const target = resolve(temp); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^mentor-client-memory-/); await rm(target, { recursive: true, force: true });
  }
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = node => node == null || node === false || node.props?.['aria-hidden'] ? '' : typeof node !== 'object' ? String(node) : (node.props?.children || []).map(text).join('');

// Tiny hook/element runner: no browser, React package, timers, or preview shell.
function renderer() {
  let current, root, props, tree, serial = 0;
  const instances = new Map(), stateUpdates = [];
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } }; },
    useState(initial) {
      const instance = current, index = instance.cursor++;
      if (!(index in instance.hooks)) instance.hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [instance.hooks[index], value => { stateUpdates.push(() => { instance.hooks[index] = typeof value === 'function' ? value(instance.hooks[index]) : value; }); }];
    },
    useRef(initial) { const [ref] = React.useState(() => ({ current: initial })); return ref; },
    useId() { const [id] = React.useState(() => `test-${++serial}`); return id; },
    useEffect(setup, deps) {
      const instance = current, index = instance.cursor++;
      const previous = instance.hooks[index];
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        instance.pending.push(() => { previous?.cleanup?.(); instance.hooks[index] = { deps, cleanup: setup() }; });
      }
    },
  };
  function walk(node, path, used) {
    if (node == null || node === false || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = `${path}:${node.type.name}:${node.props.key || ''}`;
      let instance = instances.get(key);
      if (!instance || instance.type !== node.type) {
        instance?.hooks.forEach(hook => hook?.cleanup?.());
        instance = { type: node.type, hooks: [], pending: [], cursor: 0 };
        instances.set(key, instance);
      }
      used.add(key);
      instance.cursor = 0;
      const parent = current;
      current = instance;
      const result = node.type(node.props);
      current = parent;
      return walk(result, `${key}/body`, used);
    }
    const result = { ...node, props: { ...node.props, children: node.props.children.map((child, index) => walk(child, `${path}/${child?.props?.key || index}`, used)) } };
    if (typeof node.props.ref === 'function') node.props.ref({ focus() { result.focused = true; } });
    return result;
  }
  function render(nextProps = props) {
    stateUpdates.splice(0).forEach(update => update());
    props = nextProps;
    const used = new Set();
    tree = walk(React.createElement(root, props), 'root', used);
    for (const [key, instance] of instances) {
      if (!used.has(key)) { instance.hooks.forEach(hook => hook?.cleanup?.()); instances.delete(key); }
    }
    for (const instance of instances.values()) instance.pending.splice(0).forEach(run => run());
    return tree;
  }
  return {
    React, mount(component, initialProps) { root = component; return render(initialProps); }, render,
    nodes(predicate) { const result = []; const visit = node => { if (node && typeof node === 'object') { if (predicate(node)) result.push(node); node.props.children.forEach(visit); } }; visit(tree); return result; },
    button(label) { const node = this.nodes(node => node.type === 'button' && text(node) === label)[0]; assert.ok(node, `Button ${label}`); return node; },
    field(label) { const node = this.nodes(node => node.type === 'label' && text(node).startsWith(label))[0]; assert.ok(node, `Field ${label}`); return node.props.children.find(child => child && ['input', 'textarea', 'select'].includes(child.type)); },
    dispose() { for (const instance of instances.values()) instance.hooks.forEach(hook => hook?.cleanup?.()); instances.clear(); },
    text() { return text(tree); },
  };
}
async function setup({ data = sample(), language = 'zh', snapshotCall, memoryCall, discussionCall, mountError } = {}) {
  const ui = renderer(), calls = [], disposers = [], dictionaries = new Map();
  let module, entry, contribution, registered = false, unregisters = 0;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value; } } }, AbortController });
  assert.equal(module.id, 'dsh-codex-mentor');
  const plugin = module.factory(name => { assert.equal(name, 'react'); return ui.React; });
  const remote = {
    async $mount(value) { contribution = value; if (mountError) throw mountError; return () => {}; },
    mentorCollaboration: Object.fromEntries(['snapshot', 'memory', 'discussion'].map(method => [method, async (sessionId, request, signal) => {
      calls.push({ method, sessionId, request: JSON.parse(JSON.stringify(request)), signal });
      const handler = { snapshot: snapshotCall, memory: memoryCall, discussion: discussionCall }[method];
      return handler ? handler(sessionId, request, signal) : success(method === 'snapshot' ? data : { accepted: true });
    }])),
  };
  const ctx = {
    remote,
    effect(setup) { const dispose = setup(); disposers.push(dispose); return dispose; },
    locale: {
      register(ns, lang, dict) { assert.equal(ns, 'codex-mentor.collaboration'); dictionaries.set(lang, dict); return () => dictionaries.delete(lang); },
      bind(ns) { assert.equal(ns, 'codex-mentor.collaboration'); return key => { assert.ok(Object.hasOwn(dictionaries.get(language), key), `Locale key ${key}`); return dictionaries.get(language)[key]; }; },
    },
    slots: {
      inject(name, setup) { assert.equal(name, 'conversation.composer.dock'); registered = true; disposers.push(setup()); },
      register(options, component) { entry = { options, component }; return () => { registered = false; unregisters++; }; },
    },
  };
  await plugin.apply(ctx);
  const translate = ctx.locale.bind('codex-mentor.collaboration');
  ui.mount(entry.component, { sessionId: 'session-1', t: translate });
  const click = async label => { const button = ui.button(label); assert.ok(!button.props.disabled, `${label} enabled`); await button.props.onClick?.({ preventDefault() {} }); ui.render(); };
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); ui.render(); };
  const open = async () => { await click(translate('title')); await flush(); };
  const submit = async label => {
    const form = ui.nodes(node => node.type === 'form' && text(node).includes(label))[0];
    assert.ok(form, `Form ${label}`); await form.props.onSubmit({ preventDefault() {} }); await flush();
  };
  const change = (label, value) => { ui.field(label).props.onChange({ target: { value } }); ui.render(); };
  return { ui, plugin, entry, calls, remote, dictionaries, contribution, translate, click, flush, open, submit, change,
    dispose() { ui.dispose(); disposers.reverse().forEach(dispose => dispose?.()); }, get registered() { return registered; }, get unregisters() { return unregisters; } };
}

test('native lazy artifact mounts exact Remote descriptors and session-list slot; locale effects dispose', async () => {
  new vm.Script(source);
  assert.doesNotMatch(source, /require\(['"]@deepseek-ai\/|\bset(?:Interval|Timeout)\(|document\.|window\.confirm|fetch\(/);
  const app = await setup();
  assert.deepEqual(Array.from(app.plugin.inject), ['slots', 'locale', 'remote']);
  assert.equal(app.entry.options.name, 'conversation.composer.dock');
  assert.equal(app.entry.options.id, 'dsh-codex-mentor.collaboration');
  assert.equal(app.entry.options.order, 50);
  assert.equal(app.entry.options.label(), '导师协作');
  assert.equal(app.entry.options.locale, 'codex-mentor.collaboration');
  assert.equal(app.calls.length, 0, 'no automatic requests on mount');
  assert.equal(app.contribution.package, 'dsh-codex-mentor');
  for (const descriptor of app.contribution.descriptors) {
    assert.equal(descriptor.service, 'mentorCollaboration');
    assert.equal(descriptor.namespace, 'mentorCollaboration');
    assert.equal(descriptor.invocation.kind, 'direct');
    assert.equal(descriptor.cancellation.parameter, 'signal');
    assert.equal(descriptor.parameters[0].wire, 'sessionId');
    assert.equal(descriptor.parameters[1].wire, descriptor.method === 'snapshot' ? 'query' : 'request');
    for (const parameter of descriptor.parameters) assert.equal(parameter.codec.mode, 'strict');
    assert.equal(descriptor.result.mode, 'src-json');
    assert.throws(() => descriptor.parameters[0].codec.create().parse(''));
    assert.throws(() => descriptor.parameters[1].codec.create().parse({ invalid: NaN }));
    assert.throws(() => descriptor.parameters[1].codec.create().parse({ invalid: undefined }));
  }
  assert.deepEqual(Object.keys(app.dictionaries.get('zh')).sort(), Object.keys(app.dictionaries.get('en')).sort());
  const style = app.ui.nodes(node => node.type === 'style')[0];
  assert.doesNotMatch(text(style), /#[0-9a-f]{3,8}\b|rgba?\(|--dsw-static-/i);
  app.dispose(); assert.equal(app.registered, false); assert.equal(app.unregisters, 1); assert.equal(app.dictionaries.size, 0);
});

test('explicit expansion loads once, search is explicit, accessible tabs switch without requests', async () => {
  const app = await setup(); await app.open();
  assert.equal(app.calls.length, 1);
  assert.deepEqual(app.calls[0].request, { search: '', offset: 0 });
  assert.ok(app.calls[0].signal instanceof AbortSignal, 'raw optional AbortSignal');
  assert.match(app.ui.text(), /Verified conclusion/);
  const tabs = app.ui.nodes(node => node.props.role === 'tab');
  assert.equal(tabs.length, 3);
  for (const tab of tabs) assert.ok(app.ui.nodes(node => node.props.id === tab.props['aria-controls'])[0], 'tab controls an existing panel');
  assert.equal(app.ui.nodes(node => node.props.role === 'tabpanel' && !node.props.hidden).length, 1);
  tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }); app.ui.render();
  assert.equal(app.ui.button('成员').props['aria-selected'], true);
  assert.match(app.ui.text(), /worker-current/);
  await app.click('讨论'); assert.equal(app.calls.length, 1);
  assert.match(app.ui.text(), /模型费用/);
  await app.click('记忆');
  app.ui.nodes(node => node.props.type === 'search')[0].props.onChange({ target: { value: 'verified' } }); app.ui.render();
  assert.equal(app.calls.length, 1);
  await app.submit('搜索'); assert.deepEqual(app.calls.at(-1).request, { search: 'verified', offset: 0 });
  await app.click('导师协作'); await app.click('导师协作'); await app.flush(); assert.equal(app.calls.length, 2, 'reopening keeps existing snapshot');
});

test('memory CRUD sends optimistic revisions; deletion requires inline explicit confirmation', async () => {
  const app = await setup(); await app.open();
  await app.click('新增记忆');
  app.change('结论', 'New conclusion'); app.change('证据', 'test result'); app.change('适用条件', 'version two');
  await app.submit('保存');
  assert.deepEqual(app.calls.find(call => call.method === 'memory').request, { action: 'note', scope: 'project', conclusion: 'New conclusion', evidence: 'test result', conditions: 'version two' });
  await app.click('修订'); app.change('结论', 'Revised conclusion'); await app.submit('保存');
  assert.deepEqual(app.calls.filter(call => call.method === 'memory').at(-1).request, { action: 'revise', conclusion: 'Revised conclusion', evidence: 'observed test', conditions: 'version one', id: 'm1', expected_revision: 4 });
  await app.click('确认有效'); assert.deepEqual(app.calls.filter(call => call.method === 'memory').at(-1).request, { action: 'confirm', id: 'm1', expected_revision: 4 });
  await app.click('标记失效'); assert.deepEqual(app.calls.filter(call => call.method === 'memory').at(-1).request, { action: 'invalidate', id: 'm1', expected_revision: 4 });
  const before = app.calls.length; await app.click('删除'); assert.equal(app.calls.length, before);
  assert.equal(app.ui.nodes(node => node.props.role === 'group')[0].props['aria-label'], '删除这条记忆？此操作会记录删除。');
  assert.equal(app.ui.button('确认删除').props.autoFocus, true);
  await app.click('取消'); assert.equal(app.calls.length, before);
  await app.click('删除'); await app.click('确认删除');
  assert.deepEqual(app.calls.filter(call => call.method === 'memory').at(-1).request, { action: 'forget', id: 'm1', expected_revision: 4 });
  const snapshots = app.calls.filter(call => call.method === 'snapshot').length;
  await app.click('读取详情'); assert.equal(app.calls.filter(call => call.method === 'snapshot').length, snapshots);
  assert.deepEqual(app.calls.at(-1).request, { action: 'read', id: 'm1' });
  assert.match(app.ui.text(), /Host 详情/);
});

test('discussion create uses only existing native names; post/advance/close are explicit and revisioned', async () => {
  const app = await setup(); await app.open(); await app.click('讨论');
  app.change('讨论主题', 'New discussion');
  const checkbox = app.ui.nodes(node => node.props.type === 'checkbox')[0];
  assert.equal(checkbox.props.value, 'worker-current');
  checkbox.props.onChange({ target: { checked: true } }); app.ui.render();
  await app.submit('创建讨论');
  assert.deepEqual(app.calls.filter(call => call.method === 'discussion').at(-1).request, { action: 'create', topic: 'New discussion', participants: ['worker-current'], maxRounds: 2 });
  await app.click('发送发言'); app.change('发言内容', 'Human contribution'); await app.submit('发送发言');
  assert.deepEqual(app.calls.filter(call => call.method === 'discussion').at(-1).request, { action: 'post', id: 'd1', expected_revision: 2, text: 'Human contribution' });
  await app.click('推进下一轮'); assert.deepEqual(app.calls.filter(call => call.method === 'discussion').at(-1).request, { action: 'advance', id: 'd1', expected_revision: 2 });
  await app.click('结束讨论'); app.change('结论', 'Consensus'); app.change('分歧', 'Known limitation'); await app.submit('结束讨论');
  assert.deepEqual(app.calls.filter(call => call.method === 'discussion').at(-1).request, { action: 'close', id: 'd1', expected_revision: 2, conclusion: 'Consensus', dissent: ['Known limitation'] });
  const count = app.calls.filter(call => call.method === 'snapshot').length;
  await app.click('读取讨论列表'); assert.deepEqual(app.calls.at(-1).request, { action: 'list' });
  await app.click('读取详情'); assert.deepEqual(app.calls.at(-1).request, { action: 'read', id: 'd1' });
  assert.equal(app.calls.filter(call => call.method === 'snapshot').length, count);
});

test('permissions fail closed; missing incarnations and closed discussions cannot mutate', async () => {
  const data = sample(); data.permissions = { canEditMemory: false, canDiscuss: false, canLeadDiscussion: false }; data.members[0].current = null;
  const app = await setup({ data }); await app.open();
  for (const label of ['新增记忆', '修订', '确认有效', '标记失效', '删除']) assert.equal(app.ui.button(label).props.disabled, true);
  await app.click('成员'); assert.match(app.ui.text(), /没有当前原生实例/);
  await app.click('讨论');
  for (const label of ['创建讨论', '发送发言', '推进下一轮', '结束讨论']) assert.equal(app.ui.button(label).props.disabled, true);
  assert.match(app.ui.text(), /暂无现有原生成员/); assert.equal(app.calls.length, 1);
});

test('Host and transport failures are surfaced; successful mutation plus failed refresh is honest', async () => {
  const app = await setup({ memoryCall: () => success({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'Expected revision 5', hint: 'Refresh before editing' } }) });
  await app.open(); await app.click('确认有效');
  assert.match(app.ui.text(), /REVISION_CONFLICT.*Expected revision 5.*Refresh before editing/);
  assert.equal(app.calls.filter(call => call.method === 'snapshot').length, 1);
  app.remote.mentorCollaboration.memory = async () => success({ accepted: true });
  app.remote.mentorCollaboration.snapshot = async () => ({ ok: false, error: { code: 'gateway/internal', message: 'offline' } });
  await app.click('确认有效'); assert.match(app.ui.text(), /操作已完成，但刷新失败/); assert.match(app.ui.text(), /offline/);
  assert.doesNotMatch(app.ui.text(), /操作已完成。/);
  const invalid = await setup({ snapshotCall: () => success({ memories: [] }) }); await invalid.open(); assert.match(invalid.ui.text(), /无效的协作数据/);
  const malformed = sample(); malformed.discussions[0].posts = [{}];
  const malformedApp = await setup({ data: malformed }); await malformedApp.open(); assert.match(malformedApp.ui.text(), /无效的协作数据/);
  const diagnostic = await setup({ memoryCall: () => success({ ok: false, code: 'MEMORY_FORBIDDEN', reason: 'Read-only member', required_action: 'Ask the leader' }) });
  await diagnostic.open(); await diagnostic.click('确认有效'); assert.match(diagnostic.ui.text(), /MEMORY_FORBIDDEN.*Read-only member.*Ask the leader/);
});

test('unavailable Remote mount and inactive sessions show explicit errors, not empty-state success', async () => {
  const unavailable = await setup({ mountError: new Error('namespace unavailable') }); await unavailable.open();
  assert.match(unavailable.ui.text(), /Host API 不可用.*namespace unavailable/); assert.equal(unavailable.calls.length, 0);
  const inactive = await setup(); inactive.ui.render({ sessionId: undefined, t: inactive.translate }); await inactive.open();
  assert.match(inactive.ui.text(), /没有活动会话/); assert.equal(inactive.calls.length, 0);
  assert.equal(inactive.ui.button('刷新').props.disabled, true);
});

test('previous-session request is aborted and its late success cannot overwrite new session', async () => {
  const old = deferred(), next = deferred();
  const app = await setup({ snapshotCall: sessionId => sessionId === 'session-1' ? old.promise : next.promise });
  await app.click('导师协作');
  assert.match(app.ui.text(), /正在加载/);
  const oldSignal = app.calls[0].signal;
  app.ui.render({ sessionId: 'session-2', t: app.translate });
  assert.equal(oldSignal.aborted, true);
  assert.doesNotMatch(app.ui.text(), /Verified conclusion/);
  await app.click('导师协作');
  const newData = sample(); newData.project.name = 'New session project'; newData.memories[0].conclusion = 'New session memory';
  next.resolve(success(newData)); await app.flush();
  old.resolve(success(sample())); await app.flush();
  assert.match(app.ui.text(), /New session memory/); assert.doesNotMatch(app.ui.text(), /Verified conclusion/);
});

test('latest request wins within a session; unmount aborts outstanding work', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const app = await setup({ snapshotCall: () => ++count === 1 ? first.promise : second.promise });
  await app.click('导师协作');
  const oldSignal = app.calls[0].signal;
  // Capture an explicit search handler before its loading rerender to exercise request generations.
  const searchForm = app.ui.nodes(node => node.props.role === 'search')[0];
  searchForm.props.onSubmit({ preventDefault() {} }); app.ui.render();
  assert.equal(oldSignal.aborted, true);
  const newer = sample(); newer.memories[0].conclusion = 'Latest snapshot';
  second.resolve(success(newer)); await app.flush(); first.resolve(success(sample())); await app.flush();
  assert.match(app.ui.text(), /Latest snapshot/); assert.doesNotMatch(app.ui.text(), /Verified conclusion/);
  const pending = deferred(); app.remote.mentorCollaboration.snapshot = (_sessionId, _request, signal) => { app.pendingSignal = signal; return pending.promise; };
  app.ui.button('刷新').props.onClick(); app.ui.render(); app.dispose(); assert.equal(app.pendingSignal.aborted, true);
  pending.resolve(success(sample())); for (let i = 0; i < 8; i++) await Promise.resolve();
});

test('member memory uses a logical ID; delete confirmation keeps the originally observed revision', async () => {
  const data = sample(); const app = await setup({ data }); await app.open();
  await app.click('新增记忆'); app.change('范围', 'member'); app.change('逻辑成员 ID', 'logical-1'); app.change('结论', 'Member memory'); await app.submit('保存');
  assert.deepEqual(app.calls.filter(call => call.method === 'memory').at(-1).request, { action: 'note', scope: 'member', memberId: 'logical-1', conclusion: 'Member memory', evidence: '', conditions: '' });
  await app.click('删除'); data.memories[0] = { ...data.memories[0], revision: 5 }; await app.click('刷新'); await app.click('确认删除');
  assert.equal(app.calls.filter(call => call.method === 'memory').at(-1).request.expected_revision, 4);
});

test('mutation completing after a session switch never refreshes the old session', async () => {
  const mutation = deferred(); const app = await setup({ memoryCall: () => mutation.promise }); await app.open();
  const waiting = app.ui.button('确认有效').props.onClick(); app.ui.render();
  const mutationSignal = app.calls.at(-1).signal;
  app.ui.render({ sessionId: 'session-2', t: app.translate }); assert.equal(mutationSignal.aborted, true);
  await app.open(); const before = app.calls.length;
  mutation.resolve(success({ accepted: true })); await waiting; await app.flush();
  assert.equal(app.calls.length, before); assert.equal(app.calls.at(-1).sessionId, 'session-2');
});

test('pagination and refresh preserve the loaded query, not unsent search text', async () => {
  const data = sample(); data.nextOffset = 20; const app = await setup({ data }); await app.open();
  await app.click('下一页'); assert.deepEqual(app.calls.at(-1).request, { search: '', offset: 20 });
  app.ui.nodes(node => node.props.type === 'search')[0].props.onChange({ target: { value: 'unsent' } }); app.ui.render();
  await app.click('刷新'); assert.deepEqual(app.calls.at(-1).request, { search: '', offset: 20 });
  await app.click('第一页'); assert.deepEqual(app.calls.at(-1).request, { search: '', offset: 0 });
});

test('closed discussions and omitted permissions disable mutations', async () => {
  const data = sample(); data.discussions[0].status = 'closed'; const app = await setup({ data }); await app.open(); await app.click('讨论');
  for (const label of ['发送发言', '推进下一轮', '结束讨论']) assert.equal(app.ui.button(label).props.disabled, true);
  const missing = sample(); missing.permissions = {}; const missingApp = await setup({ data: missing }); await missingApp.open();
  assert.equal(missingApp.ui.button('新增记忆').props.disabled, true); await missingApp.click('讨论'); assert.equal(missingApp.ui.button('创建讨论').props.disabled, true);
});

test('English locale comes through the native locale contract', async () => {
  const app = await setup({ language: 'en' }); assert.equal(app.entry.options.label(), 'Mentor collaboration'); await app.open();
  assert.match(app.ui.text(), /Memory/); await app.click('Discussions'); assert.match(app.ui.text(), /incur model costs/);
});
