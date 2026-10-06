window.__ModuleLoader__.load({
  id: 'dsh-codex-mentor-gui',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'codex-mentor.collaboration';
    const copy = {
      title: ['导师协作', 'Mentor collaboration'], memory: ['记忆', 'Memory'], members: ['成员', 'Members'], discussions: ['讨论', 'Discussions'],
      refresh: ['刷新', 'Refresh'], search: ['搜索记忆', 'Search memories'], searchButton: ['搜索', 'Search'], next: ['下一页', 'Next page'], first: ['第一页', 'First page'],
      loading: ['正在加载协作数据…', 'Loading collaboration…'], idle: ['展开后加载；不会自动修改数据或唤醒成员。', 'Expand to load. No automatic changes or worker wakeups.'],
      inactive: ['没有活动会话，无法使用导师协作。', 'No active session. Collaboration is unavailable.'], unavailable: ['导师协作 Host API 不可用。', 'The collaboration Host API is unavailable.'],
      invalidResult: ['Host 返回了无效的协作数据。', 'The Host returned invalid collaboration data.'], failure: ['操作失败', 'Operation failed'], saved: ['操作已完成。', 'Operation completed.'],
      refreshFailed: ['操作已完成，但刷新失败；下方数据可能已过时。', 'Operation completed, but refresh failed. The data below may be stale.'], stale: ['刷新失败；显示的是上次读取的数据。', 'Refresh failed. Showing the previous snapshot.'],
      emptyMemory: ['暂无记忆。', 'No memories.'], emptyMembers: ['暂无逻辑成员。', 'No logical members.'], emptyDiscussion: ['暂无讨论。', 'No discussions.'],
      readonly: ['当前会话没有编辑记忆的权限。', 'This session cannot edit memory.'], noDiscuss: ['当前会话没有发送讨论消息的权限。', 'This session cannot send discussion messages.'], noLead: ['当前会话没有主持讨论的权限。', 'This session cannot lead discussions.'],
      note: ['新增记忆', 'Add memory'], revise: ['修订', 'Revise'], confirm: ['确认有效', 'Confirm'], invalidate: ['标记失效', 'Invalidate'], forget: ['删除', 'Delete'], read: ['读取详情', 'Read details'],
      conclusion: ['结论', 'Conclusion'], evidence: ['证据', 'Evidence'], conditions: ['适用条件', 'Conditions'], scope: ['范围', 'Scope'], project: ['项目', 'Project'], member: ['成员', 'Member'], selectMember: ['选择成员', 'Select a member'],
      memberId: ['逻辑成员 ID', 'Logical member ID'], author: ['作者', 'Author'], updated: ['更新时间', 'Updated'], revision: ['版本', 'Revision'], status: ['状态', 'Status'],
      save: ['保存', 'Save'], cancel: ['取消', 'Cancel'], deleteQuestion: ['删除这条记忆？此操作会记录删除。', 'Delete this memory? The deletion will be recorded.'], deleteConfirm: ['确认删除', 'Confirm deletion'],
      description: ['说明', 'Description'], incarnations: ['历史实例', 'Incarnations'], nativeName: ['原生成员名', 'Native member name'], childSession: ['子会话', 'Child session'], availability: ['可用性', 'Availability'], task: ['任务', 'Task'], noCurrent: ['没有当前原生实例；不会创建替代成员。', 'No current native incarnation. No replacement will be created.'],
      create: ['创建讨论', 'Create discussion'], topic: ['讨论主题', 'Topic'], participants: ['参与成员（现有原生成员名）', 'Participants (existing native member names)'], maxRounds: ['最大轮数', 'Maximum rounds'], round: ['轮次', 'Round'],
      noNativeMembers: ['暂无现有原生成员可参加讨论。', 'No existing native members can join a discussion.'], cost: ['创建、发言和推进会发送消息，可能唤醒成员并产生模型费用；仅在点击后执行。', 'Creating, posting, or advancing sends messages and may wake workers and incur model costs. Only explicit clicks execute these actions.'],
      post: ['发送发言', 'Send post'], postText: ['发言内容', 'Post text'], advance: ['推进下一轮', 'Advance round'], close: ['结束讨论', 'Close discussion'], dissent: ['分歧', 'Dissent'], posts: ['发言记录', 'Posts'],
      list: ['读取讨论列表', 'Read discussion list'], detail: ['Host 详情', 'Host details'], closeDetail: ['收起详情', 'Hide details'], required: ['请填写必填字段并选择现有成员。', 'Complete required fields and select existing members.'], unknown: ['未知', 'Unknown'],
      active: ['有效', 'Active'], confirmed: ['已确认', 'Confirmed'], invalidated: ['已失效', 'Invalidated'], forgotten: ['已删除', 'Forgotten'], draft: ['草稿', 'Draft'], open: ['进行中', 'Open'], closed: ['已结束', 'Closed'],
    };
    const css = `
.dcm-panel{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.dcm-panel *{box-sizing:border-box}.dcm-panel button,.dcm-panel input,.dcm-panel select,.dcm-panel textarea{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:6px 10px;max-width:100%}
.dcm-panel button{cursor:pointer}.dcm-panel button:disabled{cursor:default;opacity:.5}.dcm-panel button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dcm-panel :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dcm-panel button[aria-selected=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dcm-header{display:flex;width:100%;align-items:center;justify-content:space-between;text-align:left;border:0!important;background:var(--dsw-alias-bg-layer-1);padding:8px 12px!important}
.dcm-body{padding:0 12px 12px;max-height:420px;overflow:auto}.dcm-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0}.dcm-row input[type=search]{flex:1;min-width:100px}.dcm-stack{display:grid;gap:8px}.dcm-card{border-top:1px solid var(--dsw-alias-border-l1);padding:12px 0;overflow-wrap:anywhere}.dcm-muted{color:var(--dsw-alias-label-secondary)}.dcm-error{color:var(--dsw-alias-state-error-primary)}.dcm-success{color:var(--dsw-alias-state-success-primary)}.dcm-warning{color:var(--dsw-alias-state-warn-primary)}
.dcm-panel label{display:grid;gap:4px}.dcm-panel label.dcm-check{display:flex;align-items:center;gap:8px}.dcm-panel textarea{width:100%;min-height:64px;resize:vertical}.dcm-panel fieldset{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px}.dcm-panel dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:8px 0}.dcm-panel dt{color:var(--dsw-alias-label-secondary)}.dcm-panel dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.dcm-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.dcm-panel ul{padding-left:20px}.dcm-confirm{padding:8px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px}.dcm-panel h3,.dcm-panel h4{font-size:14px;margin:8px 0}
`;

    // Native Gateway has $mount and concrete namespace methods, not $invoke.
    const json = value => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
      if (Array.isArray(value)) { value.forEach(json); return value; }
      if (value && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]') { Object.values(value).forEach(json); return value; }
      throw new TypeError('Expected a JSON value');
    };
    const codec = (typeSymbol, parse) => ({ mode: 'strict', typeSymbol, create: () => ({ parse }) });
    const identityCodec = codec('string', value => {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError('Expected sessionId');
      return value;
    });
    const objectCodec = codec('Record<string, JSONValue>', value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a JSON object');
      return json(value);
    });
    const contribution = {
      package: 'dsh-codex-mentor-gui',
      descriptors: ['snapshot', 'memory', 'discussion'].map(method => ({
        id: `dsh-codex-mentor-gui:mentorCollaboration/${method}`,
        service: 'mentorCollaboration', namespace: 'mentorCollaboration', method,
        invocation: { kind: 'direct' },
        parameters: [
          { name: 'sessionId', wire: 'sessionId', source: 'json', codec: identityCodec },
          { name: method === 'snapshot' ? 'query' : 'request', wire: method === 'snapshot' ? 'query' : 'request', source: 'json', codec: objectCodec },
        ],
        cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
      })),
    };
    function errorText(error, t) {
      const message = typeof error === 'string' ? error : error?.message || error?.reason || t('failure');
      return [error?.code, message, error?.hint || error?.required_action || error?.details?.hint].filter(Boolean).join(' · ');
    }
    function unwrap(result, t) {
      if (!result || typeof result.ok !== 'boolean') throw new Error(t('invalidResult'));
      if (!result.ok) throw result.error || new Error(t('failure'));
      const value = result.value;
      // Host business failures use the same result as the agent tools.
      if (value?.ok === false) throw value.error || value;
      return value?.ok === true && Object.hasOwn(value, 'value') ? value.value : value;
    }
    function snapshot(value, t) {
      const record = item => item && typeof item === 'object' && typeof item.id === 'string';
      if (!value || !Array.isArray(value.memories) || !Array.isArray(value.members) || !Array.isArray(value.discussions) || !value.permissions || typeof value.permissions !== 'object' || Array.isArray(value.permissions)
        || !value.memories.every(item => record(item) && typeof item.conclusion === 'string')
        || !value.members.every(item => record(item) && (item.description == null || typeof item.description === 'string') && (item.current == null || typeof item.current === 'object'))
        || !value.discussions.every(item => record(item) && typeof item.topic === 'string' && Array.isArray(item.posts) && item.posts.every(post => record(post) && typeof post.text === 'string'))) throw new Error(t('invalidResult'));
      return value;
    }
    const display = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    function fields(t, entries) {
      return h('dl', null, ...entries.flatMap(([label, value]) => [h('dt', { key: `${label}-label` }, t(label)), h('dd', { key: label }, display(value))]));
    }
    function Field({ t, name, value, onChange, required = false, type = 'text', multiline = false, disabled = false, ...rest }) {
      return h('label', null, t(name), h(multiline ? 'textarea' : 'input', {
        ...rest, type: multiline ? undefined : type, value, required, disabled,
        onChange: event => onChange(event.target.value),
      }));
    }
    function Action({ t, name, onClick, disabled, buttonRef, ...rest }) {
      return h('button', { type: 'button', disabled, onClick, ...rest, ref: buttonRef }, t(name));
    }
    function MemoryView({ t, data, busy, perform }) {
      const [editing, setEditing] = React.useState(null);
      const [deleting, setDeleting] = React.useState(null);
      const deleteButtons = React.useRef({});
      const [form, setForm] = React.useState({ scope: 'project', memberId: '', conclusion: '', evidence: '', conditions: '' });
      const editable = data.permissions.canEditMemory === true;
      const update = key => value => setForm(previous => ({ ...previous, [key]: value }));
      const start = item => {
        setEditing(item || {});
        setForm(item ? { scope: item.scope, memberId: item.memberId || '', conclusion: item.conclusion || '', evidence: display(item.evidence === undefined ? '' : item.evidence), conditions: display(item.conditions === undefined ? '' : item.conditions) } : { scope: 'project', memberId: '', conclusion: '', evidence: '', conditions: '' });
      };
      const mutate = (action, item, extra = {}) => perform('memory', { action, id: item.id, expected_revision: item.revision, ...extra });
      return h('div', null,
        !editable && h('p', { className: 'dcm-muted' }, t('readonly')),
        h(Action, { t, name: 'note', disabled: busy || !editable, onClick: () => start(null) }),
        editing && h('form', { className: 'dcm-card dcm-stack', onSubmit: async event => {
          event.preventDefault();
          if (!editable || busy || !form.conclusion.trim() || (form.scope === 'member' && !data.members.some(item => item.id === form.memberId))) return;
          const content = { conclusion: form.conclusion, evidence: form.evidence, conditions: form.conditions };
          const request = editing.id ? { action: 'revise', id: editing.id, expected_revision: editing.revision, ...content } : { action: 'note', scope: form.scope, ...content, ...(form.scope === 'member' ? { memberId: form.memberId } : {}) };
          if (await perform('memory', request)) setEditing(null);
        } },
          h('h3', null, t(editing.id ? 'revise' : 'note')),
          h('label', null, t('scope'), h('select', { value: form.scope, disabled: busy || !editable || !!editing.id, onChange: event => update('scope')(event.target.value) }, h('option', { value: 'project' }, t('project')), h('option', { value: 'member' }, t('member')))),
          form.scope === 'member' && h('label', null, t('memberId'), h('select', { value: form.memberId, required: true, disabled: busy || !editable || !!editing.id, onChange: event => update('memberId')(event.target.value) }, h('option', { value: '' }, t('selectMember')), ...data.members.map(item => h('option', { key: item.id, value: item.id }, item.description ? `${item.id} — ${item.description}` : item.id)))),
          ...['conclusion', 'evidence', 'conditions'].map(name => h(Field, { key: name, t, name, value: form[name], onChange: update(name), multiline: true, required: name === 'conclusion', autoFocus: name === 'conclusion', disabled: busy || !editable })),
          h('div', { className: 'dcm-row' }, h('button', { type: 'submit', disabled: busy || !editable || !form.conclusion.trim() || (form.scope === 'member' && !form.memberId) }, t('save')), h(Action, { t, name: 'cancel', disabled: busy, onClick: () => setEditing(null) }))),
        !data.memories.length && h('p', { className: 'dcm-muted' }, t('emptyMemory')),
        ...data.memories.map(item => h('article', { key: item.id, className: 'dcm-card' },
          h('h3', null, item.conclusion),
          fields(t, [['revision', item.revision], ['scope', item.scope === 'member' ? t('member') : item.scope === 'project' ? t('project') : item.scope], ['memberId', item.memberId], ['status', copy[item.status] ? t(item.status) : item.status], ['evidence', item.evidence], ['conditions', item.conditions], ['author', item.author], ['updated', item.updatedAt]]),
          h('div', { className: 'dcm-row' },
            h(Action, { t, name: 'read', disabled: busy, onClick: () => perform('memory', { action: 'read', id: item.id }, false) }),
            ...['revise', 'confirm', 'invalidate', 'forget'].map(action => h(Action, { key: action, t, name: action, buttonRef: action === 'forget' ? node => { deleteButtons.current[item.id] = node; } : undefined, disabled: busy || !editable || !Number.isSafeInteger(item.revision), onClick: () => action === 'revise' ? start(item) : action === 'forget' ? setDeleting(item) : mutate(action, item) }))),
          deleting?.id === item.id && h('div', { className: 'dcm-confirm', role: 'group', 'aria-label': t('deleteQuestion') },
            h('p', null, t('deleteQuestion')),
            h('div', { className: 'dcm-row' }, h(Action, { t, name: 'deleteConfirm', autoFocus: true, disabled: busy || !editable, onClick: async () => { if (await mutate('forget', deleting)) { setDeleting(null); deleteButtons.current[item.id]?.focus(); } } }), h(Action, { t, name: 'cancel', disabled: busy, onClick: () => { setDeleting(null); deleteButtons.current[item.id]?.focus(); } }))))));
    }
    function MembersView({ t, data }) {
      return h('div', null, !data.members.length && h('p', { className: 'dcm-muted' }, t('emptyMembers')),
        ...data.members.map(item => h('article', { className: 'dcm-card', key: item.id },
          h('h3', null, item.id), h('p', null, item.description),
          item.current ? fields(t, [['nativeName', item.current.nativeName], ['childSession', item.current.childSessionId], ['availability', item.current.availability], ['task', item.current.taskId], ['status', item.current.status]]) : h('p', { className: 'dcm-muted' }, t('noCurrent')),
          h('details', null, h('summary', null, t('incarnations')), h('pre', null, display(item.incarnations || []))))));
    }
    function DiscussionView({ t, data, busy, perform }) {
      const [form, setForm] = React.useState({ topic: '', participants: [], maxRounds: '2' });
      const [selected, setSelected] = React.useState(null);
      const [post, setPost] = React.useState('');
      const [conclusion, setConclusion] = React.useState('');
      const [dissent, setDissent] = React.useState('');
      const canDiscuss = data.permissions.canDiscuss === true;
      const canLead = data.permissions.canLeadDiscussion === true;
      const nativeNames = [...new Set(data.members.map(item => item.current?.nativeName).filter(name => typeof name === 'string' && name))];
      const update = key => value => setForm(previous => ({ ...previous, [key]: value }));
      return h('div', null,
        h('p', { className: 'dcm-warning' }, t('cost')),
        !canDiscuss && h('p', { className: 'dcm-muted' }, t('noDiscuss')),
        !canLead && h('p', { className: 'dcm-muted' }, t('noLead')),
        h(Action, { t, name: 'list', disabled: busy, onClick: () => perform('discussion', { action: 'list' }, false) }),
        h('form', { className: 'dcm-card dcm-stack', onSubmit: async event => {
          event.preventDefault();
          const participants = form.participants.filter(name => nativeNames.includes(name));
          const maxRounds = Number(form.maxRounds);
          if (busy || !canLead || !form.topic.trim() || !participants.length || !Number.isSafeInteger(maxRounds) || maxRounds < 1) return;
          if (await perform('discussion', { action: 'create', topic: form.topic, participants, maxRounds })) setForm({ topic: '', participants: [], maxRounds: '2' });
        } },
          h('h3', null, t('create')),
          h(Field, { t, name: 'topic', value: form.topic, onChange: update('topic'), required: true, disabled: busy || !canLead }),
          h('fieldset', { disabled: busy || !canLead }, h('legend', null, t('participants')),
            !nativeNames.length && h('p', { className: 'dcm-muted' }, t('noNativeMembers')),
            ...nativeNames.map(name => h('label', { key: name, className: 'dcm-check' }, h('input', { type: 'checkbox', value: name, checked: form.participants.includes(name), onChange: event => update('participants')(event.target.checked ? [...form.participants, name] : form.participants.filter(value => value !== name)) }), name))),
          h(Field, { t, name: 'maxRounds', type: 'number', min: 1, max: 8, step: 1, value: form.maxRounds, onChange: update('maxRounds'), required: true, disabled: busy || !canLead }),
          h('button', { type: 'submit', disabled: busy || !canLead || !form.topic.trim() || !form.participants.some(name => nativeNames.includes(name)) || !Number.isSafeInteger(Number(form.maxRounds)) || Number(form.maxRounds) < 1 }, t('create'))),
        !data.discussions.length && h('p', { className: 'dcm-muted' }, t('emptyDiscussion')),
        ...data.discussions.map(item => {
          const closed = item.status === 'closed';
          const versioned = Number.isSafeInteger(item.revision);
          return h('article', { className: 'dcm-card', key: item.id },
            h('h3', null, item.topic), fields(t, [['revision', item.revision], ['participants', item.participants], ['round', `${item.round} / ${item.maxRounds}`], ['status', copy[item.status] ? t(item.status) : item.status]]),
            h('details', null, h('summary', null, t('posts')), ...(item.posts || []).map(entry => h('div', { className: 'dcm-card', key: entry.id }, fields(t, [['author', entry.author], ['memberId', entry.memberId], ['round', entry.round]]), h('p', { style: { whiteSpace: 'pre-wrap' } }, entry.text)))),
            fields(t, [['conclusion', item.conclusion], ['dissent', item.dissent]]),
            h('div', { className: 'dcm-row' },
              h(Action, { t, name: 'read', disabled: busy, onClick: () => perform('discussion', { action: 'read', id: item.id }, false) }),
              h(Action, { t, name: 'post', disabled: busy || closed || !versioned || (!canDiscuss || item.canPost !== true), onClick: () => { setSelected({ id: item.id, revision: item.revision, action: 'post' }); setPost(''); } }),
              h(Action, { t, name: 'advance', disabled: busy || closed || !versioned || !canLead || item.round >= item.maxRounds, onClick: () => perform('discussion', { action: 'advance', id: item.id, expected_revision: item.revision }) }),
              h(Action, { t, name: 'close', disabled: busy || closed || !versioned || !canLead, onClick: () => { setSelected({ id: item.id, revision: item.revision, action: 'close' }); setConclusion(''); setDissent(''); } })),
            selected?.id === item.id && h('form', { className: 'dcm-stack', onSubmit: async event => {
              event.preventDefault();
              const action = selected.action;
              if (busy || closed || !versioned || (action === 'post' ? (!canDiscuss || item.canPost !== true) || !post.trim() : !canLead || !conclusion.trim())) return;
              const request = { action, id: item.id, expected_revision: selected.revision, ...(action === 'post' ? { text: post } : { conclusion, dissent: dissent.split('\n').map(value => value.trim()).filter(Boolean) }) };
              if (await perform('discussion', request)) setSelected(null);
            } },
              ...(selected.action === 'post' ? [h(Field, { key: 'post', t, name: 'postText', value: post, onChange: setPost, multiline: true, required: true, autoFocus: true, disabled: busy || (!canDiscuss || item.canPost !== true) || closed })] : [h(Field, { key: 'conclusion', t, name: 'conclusion', value: conclusion, onChange: setConclusion, multiline: true, required: true, autoFocus: true, disabled: busy || !canLead || closed }), h(Field, { key: 'dissent', t, name: 'dissent', value: dissent, onChange: setDissent, multiline: true, disabled: busy || !canLead || closed })]),
              h('div', { className: 'dcm-row' }, h('button', { type: 'submit', disabled: busy || closed || (selected.action === 'post' ? (!canDiscuss || item.canPost !== true) || !post.trim() : !canLead || !conclusion.trim()) }, t(selected.action)), h(Action, { t, name: 'cancel', disabled: busy, onClick: () => setSelected(null) }))));
        }));
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        for (const [index, language] of ['zh', 'en'].entries()) ctx.effect(() => ctx.locale.register(NS, language, Object.fromEntries(Object.entries(copy).map(([key, values]) => [key, values[index]]))));
        const translate = ctx.locale.bind(NS);
        let apiError = null;
        try { await ctx.remote.$mount(contribution); }
        catch (error) { apiError = error; }
        function Panel({ sessionId, t = translate }) {
          const [open, setOpen] = React.useState(false);
          const [tab, setTab] = React.useState('memory');
          const [search, setSearch] = React.useState('');
          const [view, setView] = React.useState({ sessionId, data: null, busy: false, error: null, notice: null, detail: null, query: { search: '', offset: 0 } });
          const requests = React.useRef({ sessionId, generation: 0, controller: null, disposed: false });
          const tabs = React.useRef({});
          const id = React.useId();
          if (requests.current.sessionId !== sessionId) {
            requests.current.controller?.abort();
            requests.current = { sessionId, generation: requests.current.generation + 1, controller: null, disposed: false };
          }
          React.useEffect(() => {
            requests.current.disposed = false;
            return () => { requests.current.disposed = true; requests.current.generation += 1; requests.current.controller?.abort(); };
          }, [sessionId]);
          const data = view.sessionId === sessionId ? view.data : null;
          const busy = view.sessionId === sessionId && view.busy;
          async function request(method, payload, refresh = true) {
            if (!sessionId) { setView(previous => ({ ...previous, sessionId, data: null, busy: false, notice: null, detail: null, error: t('inactive') })); return false; }
            const api = ctx.remote.mentorCollaboration;
            if (apiError || typeof api?.[method] !== 'function') { setView(previous => ({ ...previous, sessionId, error: apiError ? `${t('unavailable')} ${errorText(apiError, t)}` : t('unavailable') })); return false; }
            requests.current.controller?.abort();
            const controller = new AbortController();
            const generation = ++requests.current.generation;
            requests.current.controller = controller;
            const current = () => !controller.signal.aborted && !requests.current.disposed && requests.current.sessionId === sessionId && requests.current.generation === generation;
            const query = method === 'snapshot' ? payload : view.query;
            setView(previous => ({ ...previous, sessionId, data: previous.sessionId === sessionId ? previous.data : null, busy: true, error: null, notice: null, detail: null }));
            let changed = false;
            try {
              const value = unwrap(await api[method](sessionId, payload, controller.signal), t);
              if (!current()) return false;
              if (method === 'snapshot') {
                const fresh = snapshot(value, t);
                setView(previous => ({ ...previous, data: fresh, query }));
              } else if (refresh) {
                changed = true;
                const fresh = unwrap(await api.snapshot(sessionId, query, controller.signal), t);
                if (!current()) return false;
                const nextData = snapshot(fresh, t);
                setView(previous => ({ ...previous, data: nextData, notice: t('saved') }));
              } else setView(previous => ({ ...previous, detail: value }));
              return true;
            } catch (error) {
              if (current()) setView(previous => ({ ...previous, error: `${changed ? `${t('refreshFailed')} ` : ''}${errorText(error, t)}` }));
              return changed && current();
            } finally {
              if (current()) setView(previous => ({ ...previous, busy: false }));
            }
          }
          const load = offset => request('snapshot', { search, offset });
          const tabNames = ['memory', 'members', 'discussions'];
          const initialError = !sessionId ? t('inactive') : apiError ? `${t('unavailable')} ${errorText(apiError, t)}` : null;
          const error = initialError || (view.sessionId === sessionId ? view.error : null);
          return h('section', { className: 'dcm-panel', 'aria-label': t('title') },
            h('style', null, css),
            h('button', { type: 'button', className: 'dcm-header', 'aria-expanded': open, 'aria-controls': `${id}-body`, onClick: () => { setOpen(!open); if (!open && !data && !busy) void load(0); } }, h('span', null, t('title')), h('span', { 'aria-hidden': true }, open ? '▴' : '▾')),
            open && h('div', { id: `${id}-body`, className: 'dcm-body', 'aria-busy': busy },
              data?.project && h('p', { className: 'dcm-muted' }, `${t('project')}: ${data.project.name || data.project.id}`),
              h('form', { className: 'dcm-row', role: 'search', onSubmit: event => { event.preventDefault(); void load(0); } },
                h('input', { type: 'search', 'aria-label': t('search'), value: search, onChange: event => setSearch(event.target.value), disabled: busy || !!initialError }),
                h('button', { type: 'submit', disabled: busy || !!initialError }, t('searchButton')),
                h(Action, { t, name: 'refresh', disabled: busy || !!initialError, onClick: () => request('snapshot', view.query) })),
              h('div', { role: 'tablist', 'aria-label': t('title'), className: 'dcm-row' }, ...tabNames.map(name => h('button', { key: name, type: 'button', id: `${id}-${name}-tab`, role: 'tab', 'aria-selected': tab === name, 'aria-controls': `${id}-${name}-panel`, tabIndex: tab === name ? 0 : -1, ref: node => { tabs.current[name] = node; }, onClick: () => setTab(name), onKeyDown: event => {
                const index = tabNames.indexOf(name);
                const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
                if (next >= 0) { event.preventDefault(); setTab(tabNames[next]); tabs.current[tabNames[next]]?.focus(); }
              } }, t(name)))),
              busy && h('p', { role: 'status' }, t('loading')),
              error && h('p', { role: 'alert', className: 'dcm-error' }, error),
              error && data && h('p', { className: 'dcm-muted' }, t('stale')),
              view.sessionId === sessionId && view.notice && h('p', { role: 'status', className: 'dcm-success' }, view.notice),
              !data && !busy && !error && h('p', { className: 'dcm-muted' }, t('idle')),
              ...tabNames.map(name => h('div', { key: name, id: `${id}-${name}-panel`, role: 'tabpanel', 'aria-labelledby': `${id}-${name}-tab`, tabIndex: 0, hidden: tab !== name }, tab === name && data && h(name === 'memory' ? MemoryView : name === 'members' ? MembersView : DiscussionView, { key: `${sessionId}-${name}`, t, data, busy, perform: request }))),
              data && h('div', { className: 'dcm-row' }, view.query.offset > 0 && h(Action, { t, name: 'first', disabled: busy, onClick: () => request('snapshot', { ...view.query, offset: 0 }) }), Number.isSafeInteger(data.nextOffset) && data.nextOffset > view.query.offset && h(Action, { t, name: 'next', disabled: busy, onClick: () => request('snapshot', { ...view.query, offset: data.nextOffset }) })),
              view.sessionId === sessionId && view.detail != null && h('section', { className: 'dcm-card', 'aria-label': t('detail') }, h('h3', null, t('detail')), h('pre', null, display(view.detail)), h(Action, { t, name: 'closeDetail', onClick: () => setView(previous => ({ ...previous, detail: null })) }))));
        }
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'dsh-codex-mentor-gui.collaboration', order: 50,
          label: () => translate('title'), locale: NS,
        }, props => h(Panel, { ...props, key: props.sessionId })));
      },
    };
  },
});
