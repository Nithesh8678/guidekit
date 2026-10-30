import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Check, ChevronDown, Command, Grid2X2, HelpCircle, MoreHorizontal, Plus, Search, Users, X } from 'lucide-react';
import './landing-demo.css';

type Stage = 'idle' | 'contacts' | 'new' | 'name' | 'save' | 'complete';
type TargetRect = { x: number; y: number; width: number; height: number };
const steps = ['contacts', 'new', 'name', 'save'] as const;
const instructions: Record<(typeof steps)[number], { title: string; detail: string }> = {
  contacts: { title: 'Start with your contacts', detail: 'Open Contacts in the sidebar.' },
  new: { title: 'Make a little room', detail: 'Select New contact to get started.' },
  name: { title: 'Who are we adding?', detail: 'Type a name. The guide will keep up.' },
  save: { title: 'Ready when you are', detail: 'Save your contact to finish.' },
};
const people = [
  { name: 'Maya Chen', initials: 'MC', company: 'Studio North', color: 'lavender', status: 'Active' },
  { name: 'Alex Rivera', initials: 'AR', company: 'Orbit Design', color: 'peach', status: 'Active' },
  { name: 'Sam Taylor', initials: 'ST', company: 'Fieldwork', color: 'mint', status: 'New' },
  { name: 'Jordan Lee', initials: 'JL', company: 'Forma', color: 'blue', status: 'Active' },
];

function GuideCursor({ className = '' }: { className?: string }) {
  return <svg className={className} width="29" height="33" viewBox="0 0 29 33" fill="none" aria-hidden="true"><path d="M3 2.5 24.2 19.1l-10.1 1.7-4.5 9.1L3 2.5Z" fill="currentColor" stroke="white" strokeWidth="2.4" strokeLinejoin="round" /></svg>;
}

/** A synthetic, local interaction. It never calls the runtime or changes customer data. */
export function LandingDemo({ playRequest = 0 }: { playRequest?: number }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [measured, setMeasured] = useState(false);
  const [cursorReady, setCursorReady] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [arrival, setArrival] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contactsRef = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLSpanElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const tryRef = useRef<HTMLButtonElement>(null);
  const wasGuiding = useRef(false);
  const previousRequest = useRef(playRequest);
  const active = steps.includes(stage as (typeof steps)[number]);
  const stepNumber = steps.indexOf(stage as (typeof steps)[number]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootBounds = root.getBoundingClientRect();
    const target = stage === 'contacts' ? contactsRef.current
      : stage === 'new' ? newRef.current
        : stage === 'name' ? nameRef.current
          : stage === 'save' ? saveRef.current
            : chatOpen ? dockRef.current : launcherRef.current;
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const next = { x: bounds.left - rootBounds.left, y: bounds.top - rootBounds.top, width: bounds.width, height: bounds.height };
    setRect(active ? next : null);
    setCursor(active
      ? { x: next.x + Math.min(next.width - 9, 50), y: next.y + next.height - 7 }
      : { x: next.x + 8, y: next.y + 5 });
    setMeasured(true);
  }, [stage, active, chatOpen]);

  const start = useCallback(() => {
    setName('');
    setSavedName('');
    setFormOpen(false);
    setChatOpen(true);
    setStage('contacts');
  }, []);

  const stop = useCallback(() => {
    setStage('idle');
    setName('');
    setFormOpen(false);
    setChatOpen(true);
  }, []);

  useEffect(() => {
    if (previousRequest.current === playRequest) return;
    previousRequest.current = playRequest;
    start();
  }, [playRequest, start]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setCursorReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setArrival(false);
    const timer = window.setTimeout(() => setArrival(true), 620);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    const target = stage === 'contacts' ? contactsRef.current : stage === 'new' ? newRef.current : stage === 'name' ? nameRef.current : null;
    if (target) target.focus({ preventScroll: true });
    if (!active && wasGuiding.current) tryRef.current?.focus({ preventScroll: true });
    wasGuiding.current = active;
  }, [stage, active]);

  useEffect(() => {
    if (stage !== 'name' || !name.trim()) return;
    const timer = window.setTimeout(() => setStage('save'), 850);
    return () => window.clearTimeout(timer);
  }, [name, stage]);

  useEffect(() => {
    if (!active) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && rootRef.current?.contains(document.activeElement)) stop();
    };
    document.addEventListener('keydown', cancel);
    return () => document.removeEventListener('keydown', cancel);
  }, [active, stop]);

  const addContact = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { nameRef.current?.focus(); return; }
    setSavedName(name.trim().slice(0, 40));
    setFormOpen(false);
    setStage('complete');
    setChatOpen(true);
  };

  const tooltip = rect && rootRef.current ? {
    left: Math.min(Math.max(rect.x + 6, 12), Math.max(12, rootRef.current.clientWidth - 229)),
    top: rect.y + rect.height + 15 > rootRef.current.clientHeight - 103 ? Math.max(65, rect.y - 86) : rect.y + rect.height + 15,
  } : undefined;

  return <div className="landing-demo" ref={rootRef} aria-label="Interactive GuideKit product preview">
    <div className="ld-browser-bar">
      <div className="ld-browser-dots" aria-hidden="true"><i /><i /><i /></div>
      <div className="ld-address"><span className="ld-address-lock" aria-hidden="true">▢</span> app.northstar.example</div>
      <span className="ld-preview-label">Interactive preview</span>
    </div>

    <div className="ld-app">
      <aside className="ld-sidebar" aria-label="Preview navigation">
        <div className="ld-brand"><span>n</span><b>Northstar</b></div>
        <div className="ld-workspace"><span className="ld-workspace-avatar">S</span><span>Studio workspace</span><ChevronDown size={11} /></div>
        <button type="button" className="ld-nav-item" disabled><Grid2X2 size={14} /><span>Overview</span></button>
        <button type="button" ref={contactsRef} className="ld-nav-item ld-nav-active" onClick={() => { setFormOpen(false); if (active) setStage('new'); }}><Users size={14} /><span>Contacts</span><span className="ld-count">{savedName ? 5 : 4}</span></button>
        <button type="button" className="ld-nav-item" disabled><ArrowUpRight size={14} /><span>Activity</span></button>
        <div className="ld-sidebar-bottom"><HelpCircle size={13} /><span>Help & support</span><span className="ld-user-avatar">JL</span></div>
      </aside>

      <main className="ld-main">
        <div className="ld-topline"><span>Workspace <span>/</span> Contacts</span><span className="ld-top-avatar">JL</span></div>
        <div className="ld-page-heading"><div><h3>Contacts</h3><p>A little closer to your people.</p></div><button type="button" ref={newRef} className="ld-new-button" disabled={active && stage !== 'new'} onClick={() => { setFormOpen(true); if (stage === 'new' || !active) setStage('name'); }}><Plus size={12} /><span>New contact</span></button></div>
        <div className="ld-table-toolbar"><span className="ld-view-tab">All contacts <span>{savedName ? 5 : 4}</span></span><span className="ld-search"><Search size={12} /><span>Search contacts</span></span><MoreHorizontal size={15} /></div>
        <div className="ld-table" role="table" aria-label="Fictional contacts">
          <div className="ld-table-row ld-table-head" role="row"><span className="ld-checkbox" aria-hidden="true" /><span role="columnheader">Name <ArrowDown size={10} /></span><span role="columnheader" className="ld-company">Company</span><span role="columnheader" className="ld-status">Status</span></div>
          {(savedName ? [{ name: savedName, initials: savedName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(), company: 'Your new contact', color: 'blue', status: 'New' }, ...people] : people).map((person, index) => <div className={`ld-table-row ${index === 0 && savedName ? 'ld-added-row' : ''}`} role="row" key={`${index}-${person.name}`}>
            <span className="ld-checkbox" aria-hidden="true" /><span role="cell" className="ld-person"><span className={`ld-person-avatar ld-${person.color}`}>{person.initials}</span><span>{person.name}</span></span><span role="cell" className="ld-company">{person.company}</span><span role="cell" className="ld-status"><span className={`ld-status-pill ${person.status === 'New' ? 'ld-status-new' : ''}`}>{person.status}</span></span>
          </div>)}
        </div>
        <div className="ld-list-footer"><span>{savedName ? '5' : '4'} people. Plenty of possibilities.</span><span>1 of 1</span></div>

        {formOpen && <div className="ld-form-backdrop"><form className="ld-contact-form" onSubmit={addContact} aria-label="Add a fictional contact">
          <div className="ld-form-heading"><div><span className="ld-form-icon"><Users size={17} /></span><h4>New contact</h4></div><button type="button" aria-label="Close preview contact form" onClick={stop}><X size={16} /></button></div>
          <p>Good conversations start with a name.</p>
          <label htmlFor="ld-contact-name">Full name</label><input id="ld-contact-name" ref={nameRef} value={name} maxLength={40} onChange={(event) => { setName(event.target.value); if (stage === 'save' && !event.target.value.trim()) setStage('name'); }} onBlur={() => { if (stage === 'name' && name.trim()) setStage('save'); }} placeholder="e.g. Jamie Morgan" autoComplete="off" required />
          <div className="ld-form-note">Just a preview. No real contact is created.</div>
          <div className="ld-form-actions"><button type="button" onClick={stop}>Cancel</button><button type="submit" ref={saveRef} className="ld-save-button">Save contact</button></div>
        </form></div>}
      </main>
    </div>

    {chatOpen && <div className={`ld-chat ${stage === 'complete' ? 'ld-chat-complete' : ''} ${active ? 'ld-chat-collapsed' : ''}`} inert={active} aria-hidden={active} onTransitionEnd={measure}>
      <div className="ld-chat-heading"><span className="ld-guide-symbol" ref={dockRef} aria-hidden="true" /><span>GuideKit</span><span className="ld-chat-ready"><i />{stage === 'complete' ? 'All done' : 'Ready to help'}</span><button type="button" aria-label="Close preview assistant" onClick={() => setChatOpen(false)}><X size={13} /></button></div>
      {stage === 'complete' ? <><div className="ld-complete-title"><Check size={16} /> You made a new connection.</div><p><strong>{savedName}</strong> is in your contacts. You did it, with a little guidance along the way.</p><button type="button" ref={tryRef} className="ld-try-button" onClick={start}>Replay the guide <span aria-hidden="true">↗</span></button></>
        : <><p className="ld-chat-question">“How do I add a contact?”</p><p>I’ll show you, right here in the app.</p><button type="button" ref={tryRef} className="ld-try-button" onClick={start}>Try the guide <span aria-hidden="true">↗</span></button><div className="ld-chat-caption">A hands-on preview. No sign-up needed.</div></>}
    </div>}

    {active && <div className="ld-guide-progress"><span className="ld-progress-dots" aria-hidden="true">{steps.map((step, index) => <i key={step} className={index <= stepNumber ? 'ld-dot-filled' : ''} />)}</span><span>Step {stepNumber + 1} of 4</span><button type="button" onClick={stop}>End guide <X size={11} /></button></div>}
    {(active || !chatOpen) && <button type="button" ref={launcherRef} className="ld-launcher" aria-label={active ? 'End preview guide and open assistant' : 'Open preview assistant'} onClick={() => active ? stop() : setChatOpen(true)}>{active && <Command size={18} />}</button>}

    {active && rect && <div className={`ld-target-ring ${arrival ? 'ld-target-arrived' : ''}`} style={{ left: rect.x - 5, top: rect.y - 5, width: rect.width + 10, height: rect.height + 10 }} aria-hidden="true" />}
    {active && rect && <div className={`ld-instruction ${arrival ? 'ld-instruction-arrived' : ''}`} style={tooltip} aria-hidden="true"><span className="ld-instruction-step">{stepNumber + 1}</span><div><strong>{instructions[stage as keyof typeof instructions].title}</strong><span>{instructions[stage as keyof typeof instructions].detail}</span></div></div>}
    <div className={`ld-floating-cursor ${active ? 'ld-cursor-guiding' : ''} ${measured ? 'ld-cursor-measured' : ''}`} style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`, transition: cursorReady ? undefined : 'none' }} aria-hidden="true"><GuideCursor /><span>GuideKit</span></div>
    <span className="ld-screen-reader" role="status">{stage === 'complete' ? `Preview complete. ${savedName} was added to the fictional contact list.` : active ? `Guide step ${stepNumber + 1} of 4. ${instructions[stage as keyof typeof instructions].detail}` : 'Interactive preview ready.'}</span>
  </div>;
}
