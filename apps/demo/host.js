/* Two independent host websites using the same compiled, framework-free SDK. */
(() => {
  const kind = document.body.dataset.demo;
  const endpoint = window.__GUIDEKIT_ENDPOINT__ || 'http://127.0.0.1:4410';
  const storageKey = `guidekit-demo-${kind}-v1`;
  let records;
  try { records = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (!Array.isArray(records)) records = []; } catch { records = []; }
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  const save = () => { localStorage.setItem(storageKey, JSON.stringify(records)); render(); };
  const result = message => { document.querySelector('#form-result').textContent = message; };
  const safeString = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const createContact = (args, key) => {
    if (!safeString(args.name, 100) || !safeString(args.company, 100) || !['New', 'Qualified', 'Customer'].includes(args.status || 'New')) return { success: false, message: 'Provide a name, company, and valid contact status.' };
    const duplicate = records.find(r => r.operationId === key);
    if (duplicate) return { success: true, message: `${duplicate.name} is already saved. No duplicate was created.` };
    const record = { id: crypto.randomUUID(), operationId: key, name: args.name.trim(), company: args.company.trim(), status: args.status || 'New', createdAt: new Date().toISOString() };
    records.unshift(record); save();
    let stored; try { stored = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return { success: false, message: 'The browser could not verify the saved contact.' }; }
    const success = stored.some(r => r.id === record.id);
    return { success, message: success ? `${record.name} at ${record.company} was created and verified in Contacts.` : 'The contact was not saved.' };
  };
  const createTicket = (args, key) => {
    if (!safeString(args.subject, 160) || !safeString(args.description, 3000) || !['Normal', 'High'].includes(args.priority || 'Normal')) return { success: false, message: 'Provide a subject, details, and valid priority.' };
    const duplicate = records.find(r => r.operationId === key);
    if (duplicate) return { success: true, message: `Request ${duplicate.number} is already saved.` };
    const record = { id: crypto.randomUUID(), operationId: key, number: `FN-${String(records.length + 1).padStart(4, '0')}`, subject: args.subject.trim(), description: args.description.trim(), priority: args.priority || 'Normal', createdAt: new Date().toISOString() };
    records.unshift(record); save();
    const success = JSON.parse(localStorage.getItem(storageKey) || '[]').some(r => r.id === record.id);
    return { success, message: success ? `Request ${record.number} was saved and verified. No external email was sent.` : 'Could not verify the request.' };
  };
  function render() {
    if (kind === 'crm') {
      const query = document.querySelector('#contact-search').value.toLowerCase(), list = document.querySelector('#contacts-list'); list.replaceChildren();
      for (const record of records.filter(r => `${r.name} ${r.company}`.toLowerCase().includes(query))) {
        const tr = document.createElement('tr'); tr.append(text('td', record.name), text('td', record.company));
        const status = document.createElement('td'); status.append(text('span', record.status, 'status-pill')); tr.append(status);
        const detail = document.createElement('td'), button = text('button', 'Qualify'); button.type = 'button'; button.setAttribute('aria-label', `Qualify ${record.name}`); button.dataset.guidekitId = `qualify-${record.id}`;
        button.addEventListener('click', () => { record.status = 'Qualified'; save(); result(`${record.name} is qualified.`); }); detail.append(button); tr.append(detail); list.append(tr);
      }
      document.querySelector('#contact-count').textContent = `${records.length} ${records.length === 1 ? 'person' : 'people'}`;
      document.querySelector('#contacts-empty').hidden = records.length > 0;
      const activities = document.querySelector('#activity-list'); activities.replaceChildren();
      for (const r of records.slice(0, 5)) activities.append(text('li', `${r.name} added to Contacts · ${new Date(r.createdAt).toLocaleString()}`));
    } else {
      const list = document.querySelector('#tickets-list'); list.replaceChildren();
      for (const r of records) list.append(text('li', `${r.number} — ${r.subject} (${r.priority})`));
      document.querySelector('#tickets-empty').hidden = records.length > 0;
    }
    if (window.GuideKit) window.GuideKit.setContext({ site: kind === 'crm' ? 'Northstar CRM' : 'Fieldnotes Help Desk', records: records.map(r => kind === 'crm' ? { id: r.id, name: r.name, company: r.company, status: r.status } : { number: r.number, subject: r.subject, priority: r.priority }) });
  }
  if (kind === 'crm') {
    document.querySelector('#contact-search').addEventListener('input', render);
    document.querySelector('#contact-form').addEventListener('submit', event => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
      const outcome = createContact(data, crypto.randomUUID()); result(outcome.message); if (outcome.success) event.currentTarget.reset();
      window.GuideKit?.reportStepResult?.('create-contact', outcome);
    });
  } else document.querySelector('#ticket-form').addEventListener('submit', event => {
    event.preventDefault(); const outcome = createTicket(Object.fromEntries(new FormData(event.currentTarget)), crypto.randomUUID()); result(outcome.message); if (outcome.success) event.currentTarget.reset();
    window.GuideKit?.reportStepResult?.('create-ticket', outcome);
  });
  render();
  const params = new URL(location.href).searchParams;
  const contactSchema = { type: 'object', additionalProperties: false, required: ['name', 'company', 'status'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, company: { type: 'string', minLength: 1, maxLength: 100 }, status: { type: 'string', enum: ['New', 'Qualified', 'Customer'] } } };
  const actions = kind === 'crm' ? {
    create_contact: { description: 'Create a new contact in this CRM. The host saves it and verifies persistence. Fields: name, company, status (New, Qualified, Customer).', inputSchema: contactSchema, requiresConfirmation: true, execute: async (args, ctx) => { if (ctx.signal.aborted) return { success: false, message: 'Action was stopped.' }; const outcome = createContact(args, ctx.idempotencyKey); result(outcome.message); return outcome; } },
    update_contact_status: { description: 'Change the status of a contact from the current page context by its existing id.', inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'status'], properties: { id: { type: 'string', maxLength: 100 }, status: { type: 'string', enum: ['New', 'Qualified', 'Customer'] } } }, requiresConfirmation: true, execute: async (args, ctx) => {
      if (ctx.signal.aborted) return { success: false, message: 'Action was stopped.' };
      const record = records.find(r => r.id === args.id); if (!record || !['New', 'Qualified', 'Customer'].includes(args.status)) return { success: false, message: 'The contact or requested status is unavailable.' };
      record.status = args.status; save(); const success = JSON.parse(localStorage.getItem(storageKey) || '[]').find(r => r.id === args.id)?.status === args.status;
      return { success, message: success ? `${record.name} is now ${record.status}, verified in Contacts.` : 'The update could not be verified.' };
    } }
  } : { create_ticket: { description: 'Create a local support request; this does not send an email. Fields: subject, description, priority (Normal or High).', inputSchema: { type: 'object', additionalProperties: false, required: ['subject', 'description', 'priority'], properties: { subject: { type: 'string', minLength: 1, maxLength: 160 }, description: { type: 'string', minLength: 1, maxLength: 3000 }, priority: { type: 'string', enum: ['Normal', 'High'] } } }, requiresConfirmation: true, execute: async (args, ctx) => { if (ctx.signal.aborted) return { success: false, message: 'Action was stopped.' }; const outcome = createTicket(args, ctx.idempotencyKey); result(outcome.message); return outcome; } } };
  const state = document.querySelector('#install-state');
  let installedScript = null, widget = null, installation = 0;
  const disconnect = () => {
    ++installation;
    widget?.destroy(); widget = null;
    installedScript?.remove(); installedScript = null;
  };
  const connect = (config, onReady, onError) => {
    disconnect(); const generation = installation;
    // Only the validated URL is injected. Copying data-agent-id would trigger the
    // SDK's auto-mount and lose this host's registered actions.
    const script = document.createElement('script'); script.src = config.src; installedScript = script;
    script.addEventListener('load', async () => {
      if (generation !== installation) return;
      try {
        if (typeof window.GuideKit?.mount !== 'function') throw new Error('The script loaded, but the GuideKit SDK was not available.');
        widget = window.GuideKit.mount({ agentId: config.agentId, endpoint, actions, voice: config.voice }); render();
        const agent = await widget.ready;
        if (generation === installation) onReady(agent);
      } catch (error) {
        if (generation !== installation) return;
        disconnect(); onError(error instanceof Error ? error.message : 'Could not connect the agent. Check allowed origins and publishing.');
      }
    }, { once: true });
    script.addEventListener('error', () => {
      if (generation !== installation) return;
      disconnect(); onError('The GuideKit SDK could not load. Check that the GuideKit server is running.');
    }, { once: true });
    document.head.append(script);
  };
  if (params.get('install') === 'manual') {
    const panel = text('section', '', 'installation-lab'); panel.setAttribute('aria-labelledby', 'installation-title');
    const heading = text('h2', 'Install your GuideKit SDK'); heading.id = 'installation-title';
    const intro = text('p', 'This page starts without the SDK. Publish your agent, copy its script snippet from Dashboard → Install, and paste it below.');
    const dashboard = text('a', 'Open GuideKit dashboard'); dashboard.href = endpoint; dashboard.target = '_blank'; dashboard.rel = 'noopener';
    const form = document.createElement('form'); form.dataset.guidekitPrivate = '';
    const label = text('label', 'SDK script snippet'); label.htmlFor = 'sdk-snippet';
    const snippet = document.createElement('textarea'); snippet.id = 'sdk-snippet'; snippet.rows = 6; snippet.maxLength = 8000; snippet.spellcheck = false; snippet.autocomplete = 'off'; snippet.placeholder = '<script src="…/sdk/guidekit.js" data-agent-id="agt_…" data-endpoint="…" defer></script>';
    const controls = text('div', '', 'installation-controls');
    const install = text('button', 'Install SDK', 'primary'); install.type = 'submit';
    const remove = text('button', 'Remove assistant', 'secondary'); remove.type = 'button'; remove.disabled = true;
    controls.append(install, remove); form.append(label, snippet, controls);
    const status = text('p', 'SDK not loaded. No assistant is mounted.', 'installation-status'); status.id = 'manual-install-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.state = 'not-loaded';
    const instructions = document.createElement('ol');
    for (const instruction of [
      `Allow this exact website origin in your agent before publishing: ${location.origin}`,
      'After connection, press ⌘⇧K on Mac or Ctrl+Shift+K on Windows. Allow the microphone when your browser asks, then speak your question.',
      'Press the shortcut again to finish and send your speech, or press Escape to cancel. The chat microphone and typing remain available.',
      'Try “How do I add a contact?” for visual guidance, then “Create a contact named Jamie Rivera at Acme Studio.” Review the proposed change and approve it to save a browser demo record.'
    ]) instructions.append(text('li', kind === 'support' ? instruction.replace('How do I add a contact?', 'Where can I find invoices?').replace('Create a contact named Jamie Rivera at Acme Studio.', 'Create a support request about a missing invoice.') : instruction));
    const note = text('p', 'Voice uses your browser’s speech service, which may process audio online. Browser support and microphone permission are required. Chrome or Edge is recommended for voice testing. Speech output uses your browser’s voices.', 'fine');
    panel.append(heading, intro, dashboard, form, status, instructions, note); state.before(panel);
    const setState = (name, message) => { status.dataset.state = name; status.textContent = message; };
    const reset = () => { install.disabled = false; snippet.disabled = false; remove.disabled = true; form.removeAttribute('aria-busy'); };
    remove.addEventListener('click', () => { disconnect(); reset(); setState('removed', 'Assistant removed. No assistant is mounted. Install again to reconnect.'); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      let config;
      try { config = parseSnippet(snippet.value); }
      catch (error) { setState('error', error instanceof Error ? error.message : 'Paste the script snippet from GuideKit.'); return; }
      install.disabled = true; snippet.disabled = true; remove.disabled = false; form.setAttribute('aria-busy', 'true'); setState('loading', 'Loading the real SDK and connecting to your published agent…');
      connect(config, agent => {
        form.removeAttribute('aria-busy');
        const permitted = Object.keys(actions).filter(name => agent.allowedActions.includes(name)).length;
        setState('ready', `Connected to ${agent.name} · published version ${agent.version}. ${permitted} host ${permitted === 1 ? 'action is' : 'actions are'} available with approval.`);
      }, message => { reset(); setState('error', `Connection failed: ${message}`); });
    });
    return;
  }
  const agentId = params.get('agentId');
  if (!agentId || !/^agt_[a-zA-Z0-9_-]{1,150}$/.test(agentId)) {
    state.append(document.createTextNode('Publish an agent in GuideKit, then open this website from its installation page. ')); const link = text('a', 'Open GuideKit'); link.href = endpoint; state.append(link); return;
  }
  connect({ agentId, src: `${endpoint}/sdk/guidekit.js`, voice: { provider: 'browser', hotkeyStartsListening: true, autoSubmit: true } }, () => {}, message => { state.textContent = message; });

  function parseSnippet(value) {
    // Limit the input to a single empty script before creating an inert document.
    // Arbitrary HTML, event handlers, inline code and alternative URLs never reach
    // the live DOM, even if their text resembles a valid GuideKit installation.
    if (!value.trim() || value.length > 8000 || !/^\s*<script\b[^>]*>\s*<\/script>\s*$/i.test(value)) throw new Error('Paste one complete, empty GuideKit script tag from Dashboard → Install.');
    const parsed = new DOMParser().parseFromString(value, 'text/html');
    const scripts = parsed.querySelectorAll('script');
    if (scripts.length !== 1 || parsed.body.children.length > 0 || scripts[0].textContent.trim()) throw new Error('The snippet must contain only one GuideKit script tag, with no inline code.');
    const script = scripts[0];
    const allowed = new Set(['src', 'data-agent-id', 'data-endpoint', 'defer', 'data-voice-provider', 'data-voice-hotkey', 'data-voice-auto-submit']);
    if ([...script.attributes].some(attribute => !allowed.has(attribute.name))) throw new Error('The snippet contains unsupported attributes. Copy it again from Dashboard → Install.');
    const expected = new URL(endpoint).origin;
    let source, configured;
    try { source = new URL(script.getAttribute('src')); configured = new URL(script.getAttribute('data-endpoint') || expected); }
    catch { throw new Error('The SDK source and endpoint must be complete GuideKit URLs.'); }
    if (source.href !== `${expected}/sdk/guidekit.js` || configured.origin !== expected || configured.href !== `${expected}/`) throw new Error(`Use the GuideKit SDK served by ${expected}/sdk/guidekit.js. Other script sources and endpoints are not installed here.`);
    const agentId = script.getAttribute('data-agent-id');
    if (!agentId || !/^agt_[a-zA-Z0-9_-]{1,150}$/.test(agentId)) throw new Error('The snippet needs a valid published data-agent-id. Copy it again from Dashboard → Install.');
    const provider = script.getAttribute('data-voice-provider') || 'browser';
    const hotkey = script.getAttribute('data-voice-hotkey') || 'true';
    const autoSubmit = script.getAttribute('data-voice-auto-submit') || 'true';
    if (!['browser', 'disabled'].includes(provider) || !['true', 'false'].includes(hotkey) || !['true', 'false'].includes(autoSubmit)) throw new Error('Use browser voice settings from the current GuideKit installation snippet.');
    return { agentId, src: source.href, voice: { provider, hotkeyStartsListening: hotkey === 'true', autoSubmit: autoSubmit === 'true' } };
  }
})();
