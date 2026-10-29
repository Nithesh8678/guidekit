/* Two independent host websites using the same compiled, framework-free SDK. */
(() => {
  const kind = document.body.dataset.demo;
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
    });
  } else document.querySelector('#ticket-form').addEventListener('submit', event => {
    event.preventDefault(); const outcome = createTicket(Object.fromEntries(new FormData(event.currentTarget)), crypto.randomUUID()); result(outcome.message); if (outcome.success) event.currentTarget.reset();
  });
  render();
  const agentId = new URL(location.href).searchParams.get('agentId');
  if (!agentId || !/^agt_[a-zA-Z0-9_-]{1,150}$/.test(agentId)) {
    const state = document.querySelector('#install-state'); state.append(document.createTextNode('Publish an agent in GuideKit, then open this website from its installation page. ')); const link = text('a', 'Open GuideKit'); link.href = 'http://127.0.0.1:4410'; state.append(link); return;
  }
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
  const script = document.createElement('script'); script.src = 'http://127.0.0.1:4410/sdk/guidekit.js';
  script.addEventListener('load', () => { const widget = window.GuideKit.mount({ agentId, endpoint: 'http://127.0.0.1:4410', actions }); render(); widget.ready?.catch(error => { document.querySelector('#install-state').textContent = error.message || 'Could not connect the agent. Check allowed origins and publishing.'; }); });
  script.addEventListener('error', () => { document.querySelector('#install-state').textContent = 'The GuideKit SDK could not load. Start the GuideKit server on port 4410.'; }); document.head.append(script);
})();
