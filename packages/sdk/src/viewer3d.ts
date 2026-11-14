import { Box3, BoxHelper, Color, PerspectiveCamera, Raycaster, Spherical, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import type { VisualScene } from '../../contracts/src/visual';
import type { VisualPresentation, VisualSelection } from './session-types';
import type { VisualViewer } from './viewer3d-loader';
import { prepareVisual, visualCameraIntent, visualFitDistance, type PreparedVisual } from './viewer3d-model';

const styles = `
.gk-viewer{pointer-events:auto;position:fixed;left:24px;bottom:24px;width:min(680px,calc(100vw - 460px));height:min(650px,calc(100dvh - 80px));min-width:280px;display:flex;flex-direction:column;overflow:hidden;background:#fff;border:1px solid #dce3ee;border-radius:20px;box-shadow:0 20px 70px #17213b20;color:#17213b;font:13px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;z-index:4}.gk-viewer[hidden]{display:none!important}.gk-viewer-head{display:flex;align-items:flex-start;gap:16px;padding:19px 20px 13px}.gk-viewer-heading{min-width:0;flex:1}.gk-viewer h2{font-size:19px;line-height:1.3;letter-spacing:-.025em;font-weight:650;margin:0 0 7px;overflow-wrap:anywhere}.gk-viewer-summary{margin:0;font-size:12px;line-height:1.55;color:#64718a;max-height:75px;overflow:auto}.gk-viewer button{font:inherit;cursor:pointer;border:0}.gk-viewer button:focus-visible,.gk-viewer-stage:focus-visible{outline:3px solid #a7b8ff;outline-offset:2px}.gk-viewer-hide{flex-shrink:0;padding:5px 8px;border-radius:7px;background:#f0f3f8;color:#52617b;font-size:11px!important}.gk-viewer-content{min-height:0;flex:1;display:grid;grid-template-columns:minmax(0,1fr) 166px;border-top:1px solid #edf0f6}.gk-viewer-main{display:flex;min-height:0;min-width:0;flex-direction:column;background:#f4f7fb}.gk-viewer-stage{position:relative;flex:1;min-height:180px;overflow:hidden;touch-action:none;outline:none;isolation:isolate}.gk-viewer-stage>canvas,.gk-viewer-stage>svg{display:block!important;width:100%!important;height:100%!important;position:absolute;inset:0;z-index:0}.gk-viewer-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1}.gk-viewer-label{position:absolute;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 6px;border:1px solid #dce3ed;border-radius:6px;background:#ffffffed;color:#46546d;font-size:10px;line-height:15px;transform:translate(-50%,-100%);box-shadow:0 2px 5px #17213b09}.gk-viewer-label[data-selected=true]{background:#fff2cf;border-color:#e5b454;color:#574014;font-weight:650}.gk-viewer-controls{flex-shrink:0;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px;padding:8px 9px;border-top:1px solid #e7ecf3;background:#fbfcfe}.gk-viewer-controls button{height:29px;min-width:29px;border-radius:7px;background:#fff;border:1px solid #dfe5ef;color:#53617a;font-size:12px}.gk-viewer-controls button:hover{background:#edf2fa}.gk-viewer-controls .gk-viewer-reset{padding:0 9px;margin-left:3px}.gk-viewer-instructions{margin:0;padding:0 12px 9px;text-align:center;font-size:10px;color:#738099;background:#fbfcfe}.gk-viewer-objects{min-width:0;min-height:0;overflow:auto;padding:13px 10px;background:#fff;border-left:1px solid #e7ecf3}.gk-viewer-objects h3{margin:0 4px 9px;font-size:11px;font-weight:600;color:#64718a}.gk-viewer-objects ul{list-style:none;margin:0;padding:0;display:grid;gap:3px}.gk-viewer-object{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 8px;border-radius:7px;background:transparent;color:#4b5971;font-size:11px!important;overflow-wrap:anywhere}.gk-viewer-object:hover{background:#f4f6fa}.gk-viewer-object[aria-pressed=true]{background:#fff3d7;color:#624516}.gk-viewer-swatch{height:8px;width:8px;border-radius:50%;flex-shrink:0;border:1px solid #17213b20}.gk-viewer-detail{padding:11px 20px;border-top:1px solid #e7ecf3;background:#fff;min-height:52px;max-height:110px;overflow:auto}.gk-viewer-detail strong{font-size:12px;margin-right:8px;font-weight:650}.gk-viewer-detail span{font-size:11px;color:#64718a}.gk-viewer-note{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 20px;border-top:1px solid #f0f3f7;font-size:10px;color:#8791a3}.gk-viewer-error{color:#98502d}.gk-viewer-status{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important}
@media(max-width:899px){.gk-viewer{left:12px;right:12px;bottom:12px;width:calc(100vw - 24px);height:calc(100dvh - 68px);min-width:0}.gk-viewer-content{grid-template-columns:minmax(0,1fr) 142px}.gk-viewer-head{padding:15px 15px 11px}.gk-viewer-detail{padding:10px 15px}.gk-viewer-note{padding:7px 15px}}@media(max-width:520px){.gk-viewer-content{display:flex;flex-direction:column}.gk-viewer-main{flex:1;min-height:0}.gk-viewer-stage{min-height:100px}.gk-viewer-objects{max-height:120px;flex-shrink:0;border-left:0;border-top:1px solid #e7ecf3;padding:8px 10px}.gk-viewer-objects ul{display:flex;gap:4px;flex-wrap:wrap}.gk-viewer-objects li{max-width:100%}.gk-viewer-object{width:auto;padding:5px 7px}.gk-viewer-objects h3{margin-bottom:4px}.gk-viewer-summary{max-height:52px}.gk-viewer-detail{max-height:72px}.gk-viewer h2{font-size:17px}.gk-viewer-label{max-width:110px}}@media(max-height:450px){.gk-viewer{overflow:auto}.gk-viewer-head{padding:9px 12px;flex-shrink:0}.gk-viewer-content{flex:0 0 180px;min-height:180px}.gk-viewer-summary,.gk-viewer-instructions,.gk-viewer-note{display:none}.gk-viewer-stage{min-height:55px}.gk-viewer-objects{max-height:65px}.gk-viewer-detail{min-height:30px;max-height:48px;padding:5px 12px;flex-shrink:0}.gk-viewer-controls{padding:4px}.gk-viewer h2{font-size:15px;margin:0}}`;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const abort = () => new DOMException('The explanation presentation was replaced or stopped.', 'AbortError');
interface Pending { visual: PreparedVisual; camera: PerspectiveCamera; target: Vector3; selected: string; runId: string; resolve(value: VisualPresentation): void; reject(error: unknown): void; }
interface Renderer { kind: 'webgl' | 'svg'; element: HTMLElement | SVGElement; size(width: number, height: number): void; render(scene: PreparedVisual['scene'], camera: PerspectiveCamera): void; dispose(): void; }

function renderer(): Renderer {
  const canvas = document.createElement('canvas');
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'low-power' });
    if (context) {
      const engine = new WebGLRenderer({ canvas, context, antialias: true, alpha: false }); engine.outputColorSpace = SRGBColorSpace; engine.setClearColor(0xf4f7fb, 1); engine.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      return { kind: 'webgl', element: canvas, size: (width, height) => engine.setSize(width, height, false), render: (scene, camera) => { if (context!.isContextLost()) throw new Error('The graphics context is unavailable.'); engine.render(scene, camera); }, dispose: () => { engine.dispose(); engine.forceContextLoss(); canvas.remove(); } };
    }
  } catch { context?.getExtension('WEBGL_lose_context')?.loseContext(); }
  const engine = new SVGRenderer(); engine.setQuality('low'); engine.setPrecision(3); engine.setClearColor(new Color(0xf4f7fb), 1);
  return { kind: 'svg', element: engine.domElement, size: (width, height) => engine.setSize(width, height), render: (scene, camera) => engine.render(scene, camera), dispose: () => { engine.clear(); engine.domElement.replaceChildren(); engine.domElement.remove(); } };
}

class ExplanationViewer implements VisualViewer {
  private readonly root = element('section', 'gk-viewer');
  private readonly title = element('h2');
  private readonly summary = element('p', 'gk-viewer-summary');
  private readonly stage = element('div', 'gk-viewer-stage');
  private readonly labels = element('div', 'gk-viewer-labels');
  private readonly objectList = element('ul');
  private readonly detail = element('div', 'gk-viewer-detail');
  private readonly feedback = element('span');
  private readonly live = element('div', 'gk-viewer-status');
  private readonly engine: Renderer;
  private readonly camera = new PerspectiveCamera(42, 1, .02, 1000);
  private readonly controls: OrbitControls;
  private readonly resize: ResizeObserver;
  private readonly lifetime = new AbortController();
  private readonly media = matchMedia('(prefers-reduced-motion: reduce)');
  private current: PreparedVisual | null = null;
  private pending: Pending | null = null;
  private selected: string | null = null;
  private selectionBox: BoxHelper | null = null;
  private readonly tags = new Map<string, HTMLElement>();
  private frame = 0;
  private frameCount = 0;
  private settling = 0;
  private inFrame = false;
  private visible = true;
  private disposed = false;
  private width = 0;
  private height = 0;
  private pointer: { x: number; y: number; id: number; visual: PreparedVisual | null } | null = null;

  constructor(container: HTMLElement, options: { onHide(): void }) {
    const style = element('style'); style.textContent = styles; this.root.append(style);
    this.root.dataset.gkViewer = ''; this.root.setAttribute('role', 'region'); this.root.setAttribute('aria-label', 'Interactive 3D explanation');
    const head = element('header', 'gk-viewer-head'), heading = element('div', 'gk-viewer-heading'); heading.append(this.title, this.summary);
    head.append(heading, this.button('Back to chat', 'Hide 3D explanation', () => options.onHide(), 'gk-viewer-hide'));
    const content = element('div', 'gk-viewer-content'), main = element('div', 'gk-viewer-main'), actions = element('div', 'gk-viewer-controls');
    this.stage.tabIndex = 0; this.stage.setAttribute('role', 'group'); this.stage.setAttribute('aria-label', '3D model. Arrow keys rotate, plus and minus zoom, Home resets.');
    this.labels.setAttribute('aria-hidden', 'true'); this.stage.append(this.labels);
    actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', '3D view controls');
    for (const [text, label, operation] of [
      ['←', 'Rotate left', () => this.orbit(-.24, 0)], ['→', 'Rotate right', () => this.orbit(.24, 0)], ['↑', 'Rotate up', () => this.orbit(0, -.2)], ['↓', 'Rotate down', () => this.orbit(0, .2)],
      ['+', 'Zoom in', () => this.zoom(.8)], ['−', 'Zoom out', () => this.zoom(1.25)], ['Focus', 'Focus selected object', () => this.focusSelected()], ['Reset', 'Reset 3D view', () => this.reset()]
    ] as const) actions.append(this.button(text, label, operation, text === 'Reset' ? 'gk-viewer-reset' : ''));
    main.append(this.stage, actions, element('p', 'gk-viewer-instructions', 'Drag to orbit. Scroll or pinch to zoom.'));
    const objects = element('aside', 'gk-viewer-objects'); objects.setAttribute('aria-label', 'Model objects'); objects.append(element('h3', '', 'Objects'), this.objectList);
    content.append(main, objects);
    const note = element('div', 'gk-viewer-note'); note.append(element('span', '', 'Conceptual illustration'), this.feedback);
    this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'true');
    this.root.append(head, content, this.detail, note, this.live); container.append(this.root);
    this.engine = renderer(); this.engine.element.setAttribute('aria-hidden', 'true'); this.engine.element.setAttribute('data-gk-renderer', this.engine.kind); this.stage.prepend(this.engine.element); this.root.dataset.gkRenderer = this.engine.kind;
    // OrbitControls supports both canvas and SVG event targets at runtime.
    this.controls = new OrbitControls(this.camera, this.engine.element as HTMLElement); this.controls.enableDamping = !this.media.matches; this.controls.dampingFactor = .14; this.controls.enablePan = false; this.controls.autoRotate = false; this.controls.maxPolarAngle = Math.PI - .08; this.controls.minPolarAngle = .08;
    this.controls.addEventListener('change', this.changed); this.controls.addEventListener('start', this.started); this.controls.addEventListener('end', this.started);
    this.stage.addEventListener('keydown', this.keyboard, { signal: this.lifetime.signal });
    this.stage.addEventListener('pointerdown', event => { if (event.button === 0) this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId, visual: this.current }; }, { capture: true, signal: this.lifetime.signal });
    this.stage.addEventListener('pointerup', this.pick, { capture: true, signal: this.lifetime.signal });
    this.stage.addEventListener('pointercancel', () => { this.pointer = null; }, { signal: this.lifetime.signal });
    document.addEventListener('visibilitychange', this.visibility, { signal: this.lifetime.signal }); this.media.addEventListener('change', this.preference);
    this.resize = new ResizeObserver(() => { this.size(); this.invalidate(); }); this.resize.observe(this.stage); this.size();
  }
  private button(text: string, label: string, operation: () => void, className = ''): HTMLButtonElement { const button = element('button', className, text); button.type = 'button'; button.setAttribute('aria-label', label); button.addEventListener('click', operation, { signal: this.lifetime.signal }); return button; }
  present(scene: VisualScene, runId: string): Promise<VisualPresentation> {
    if (this.disposed) return Promise.reject(abort());
    this.cancelPending();
    let visual: PreparedVisual;
    try { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(runId)) throw new Error('Invalid explanation reference.'); visual = prepareVisual(scene); }
    catch (error) { this.feedback.textContent = 'Update unavailable; your previous view is preserved.'; this.feedback.className = 'gk-viewer-error'; this.live.textContent = 'The 3D update is unavailable. Your previous model is preserved.'; return Promise.reject(error); }
    this.show(); this.size();
    const camera = this.camera.clone(), target = this.controls.target.clone(), intent = visualCameraIntent(this.current?.spec ?? null, visual.spec);
    const selected = visual.spec.focusId ?? (this.current?.spec.id === visual.spec.id && this.selected && visual.objects.has(this.selected) ? this.selected : visual.spec.objects[0]!.id);
    if (intent !== 'preserve') this.fit(camera, target, intent === 'focus' ? new Box3().setFromObject(visual.objects.get(selected)!) : visual.bounds, intent === 'reset');
    return new Promise((resolve, reject) => { this.pending = { visual, camera, target, selected, runId, resolve, reject }; this.invalidate(); });
  }
  selection(): VisualSelection | null { return this.current && !this.disposed ? { sceneId: this.current.spec.id, ...(this.selected ? { selectedObjectId: this.selected } : {}) } : null; }
  focusObject(id: string): boolean { if (this.disposed || !this.visible || document.hidden || !this.current?.objects.has(id)) return false; this.select(id); this.focusSelected(); return true; }
  cancelPresentation(): void { this.cancelPending(); if (!this.current) this.cancelFrame(); }
  hide(): void { if (this.disposed) return; this.visible = false; this.root.hidden = true; this.controls.enabled = false; this.cancelFrame(); this.cancelPending(); }
  show(): void { if (this.disposed) return; this.visible = true; this.root.hidden = false; this.controls.enabled = !document.hidden; this.size(); this.invalidate(); }
  private cancelPending(): void { const pending = this.pending; this.pending = null; if (pending) { pending.visual.dispose(); pending.reject(abort()); } }
  private size(): void {
    if (!this.visible || this.disposed) return;
    const bounds = this.stage.getBoundingClientRect(), width = Math.max(1, Math.min(1280, Math.round(bounds.width))), height = Math.max(1, Math.min(960, Math.round(bounds.height)));
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height; this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    if (this.pending) { this.pending.camera.aspect = this.camera.aspect; this.pending.camera.updateProjectionMatrix(); }
    this.engine.size(width, height);
  }
  private fit(camera: PerspectiveCamera, target: Vector3, box: Box3, reset: boolean): void {
    const center = box.getCenter(new Vector3()), radius = box.getSize(new Vector3()).length() / 2;
    const direction = reset ? new Vector3(4, 2.5, 5).normalize() : camera.position.clone().sub(target).normalize();
    if (!direction.lengthSq()) direction.set(4, 2.5, 5).normalize();
    target.copy(center); camera.position.copy(center).addScaledVector(direction, visualFitDistance(radius, camera.aspect)); camera.lookAt(center); camera.updateMatrixWorld();
  }
  private changed = (): void => { if (!this.inFrame) { this.settling = 0; this.invalidate(); } };
  private started = (): void => { this.settling = 0; this.invalidate(); };
  private preference = (): void => { this.controls.enableDamping = !this.media.matches; this.invalidate(); };
  private visibility = (): void => { this.controls.enabled = this.visible && !document.hidden; if (document.hidden) this.cancelFrame(); else if (this.visible) { this.size(); this.invalidate(); } };
  private invalidate(): void { if (!this.frame && !this.disposed && this.visible && !document.hidden) { this.root.dataset.gkFramePending = 'true'; this.frame = requestAnimationFrame(this.paint); } }
  private cancelFrame(): void { cancelAnimationFrame(this.frame); this.frame = 0; this.root.dataset.gkFramePending = 'false'; }
  private commit(pending: Pending): boolean {
    const previous = this.current, camera = this.camera.clone(), target = this.controls.target.clone(), selected = this.selected, minimum = this.controls.minDistance, maximum = this.controls.maxDistance;
    try {
      // Keep the current scene and its resources until the candidate has
      // actually rendered. A validation/render failure cannot erase it.
      this.engine.render(pending.visual.scene, pending.camera);
      this.disposeSelectionBox(); this.current = pending.visual; this.camera.copy(pending.camera); this.controls.target.copy(pending.target); this.selected = pending.selected;
      const radius = this.current.bounds.getSize(new Vector3()).length() / 2; this.controls.minDistance = Math.max(.15, radius * .02); this.controls.maxDistance = Math.max(60, radius * 16);
      this.controls.update(); this.refreshObjects(); this.highlight(); this.engine.render(this.current.scene, this.camera);
      this.pending = null; previous?.dispose();
      this.root.dataset.gkSceneId = pending.visual.spec.id; this.root.dataset.gkSceneRun = pending.runId; this.root.dataset.gkObjectCount = String(pending.visual.spec.objects.length); this.root.dataset.gkMeshCount = String(pending.visual.meshes.length);
      this.feedback.textContent = ''; this.feedback.className = ''; this.live.textContent = `${pending.visual.spec.title}. ${pending.visual.spec.objects.length} objects. Model ready.`;
      pending.resolve({ sceneId: pending.visual.spec.id, renderer: this.engine.kind }); return true;
    } catch {
      this.disposeSelectionBox(); this.current = previous; this.camera.copy(camera); this.controls.target.copy(target); this.controls.minDistance = minimum; this.controls.maxDistance = maximum; this.selected = selected; this.pending = null; pending.visual.dispose();
      if (previous) { this.refreshObjects(); this.highlight(); try { this.engine.render(previous.scene, this.camera); } catch { /* Retain the validated model for a later renderer retry. */ } }
      this.feedback.textContent = 'The model could not be updated. Your last view is still available.'; this.feedback.className = 'gk-viewer-error'; this.live.textContent = this.feedback.textContent; pending.reject(new Error('The explanation could not be rendered. The previous scene was preserved.')); return false;
    }
  }
  private paint = (): void => {
    this.frame = 0; this.root.dataset.gkFramePending = 'false';
    if (this.disposed || !this.visible || document.hidden) return;
    this.inFrame = true;
    try {
      const pending = this.pending;
      if (pending && !this.commit(pending)) return;
      const changing = this.controls.update();
      if (this.current) { this.engine.render(this.current.scene, this.camera); this.positionLabels(); this.frameCount++; this.root.dataset.gkRenderedFrames = String(this.frameCount); this.root.dataset.gkCamera = JSON.stringify({ position: this.camera.position.toArray(), target: this.controls.target.toArray() }); }
      if (changing && ++this.settling < 100 && !this.media.matches) this.invalidate();
    } catch (error) {
      this.cancelPending(); this.feedback.textContent = 'The model could not be updated. Your last view is still available.'; this.feedback.className = 'gk-viewer-error';
      this.live.textContent = this.feedback.textContent;
      if (this.current) { try { this.engine.render(this.current.scene, this.camera); } catch { /* Keep the last validated scene for a later retry. */ } }
    } finally { this.inFrame = false; }
  };
  private refreshObjects(): void {
    if (!this.current) return;
    const visual = this.current;
    const active = this.root.getRootNode() instanceof ShadowRoot ? (this.root.getRootNode() as ShadowRoot).activeElement : document.activeElement;
    const focused = active instanceof HTMLElement ? active.dataset.gkObjectId : undefined;
    this.title.textContent = this.current.spec.title; this.summary.textContent = this.current.spec.summary; this.objectList.replaceChildren(); this.labels.replaceChildren(); this.tags.clear();
    for (const [index, object] of this.current.spec.objects.entries()) {
      const item = element('li'), select = this.button(object.label, `Select ${object.label}`, () => { if (this.current === visual) this.select(object.id); }, 'gk-viewer-object'); select.dataset.gkObjectId = object.id;
      const swatch = element('span', 'gk-viewer-swatch'); swatch.style.backgroundColor = object.color; swatch.setAttribute('aria-hidden', 'true'); select.prepend(swatch); item.append(select); this.objectList.append(item);
      if (index < 8 || object.id === this.selected) { const label = element('span', 'gk-viewer-label', object.label); this.labels.append(label); this.tags.set(object.id, label); }
      if (focused === object.id) select.focus({ preventScroll: true });
    }
    this.updateDetail();
  }
  private updateDetail(): void {
    const object = this.current?.spec.objects.find(object => object.id === this.selected); this.detail.replaceChildren();
    if (object) this.detail.append(element('strong', '', object.label), element('span', '', object.description || 'Select Focus to bring this object closer.'));
    for (const button of this.objectList.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.gkObjectId === this.selected));
    for (const [id, label] of this.tags) label.dataset.selected = String(id === this.selected);
  }
  private select(id: string): void {
    if (!this.current?.objects.has(id) || this.disposed) return;
    this.selected = id; if (!this.tags.has(id)) { const object = this.current.spec.objects.find(object => object.id === id)!; const label = element('span', 'gk-viewer-label', object.label); this.labels.append(label); this.tags.set(id, label); }
    this.updateDetail(); this.highlight(); this.live.textContent = `${this.current.spec.objects.find(object => object.id === id)!.label} selected.`; this.invalidate();
  }
  private highlight(): void { this.disposeSelectionBox(); const object = this.selected ? this.current?.objects.get(this.selected) : null; if (object && this.current) { this.selectionBox = new BoxHelper(object, 0xe4a932); this.current.scene.add(this.selectionBox); } }
  private disposeSelectionBox(): void { if (!this.selectionBox) return; this.selectionBox.removeFromParent(); this.selectionBox.geometry.dispose(); this.selectionBox.material.dispose(); this.selectionBox = null; }
  private positionLabels(): void {
    if (!this.current) return;
    for (const [id, label] of this.tags) {
      const object = this.current.objects.get(id)!, box = new Box3().setFromObject(object), position = box.getCenter(new Vector3()); position.y = box.max.y; position.project(this.camera);
      const outside = position.z < -1 || position.z > 1 || Math.abs(position.x) > 1.3 || Math.abs(position.y) > 1.3; label.hidden = outside;
      const x = Math.max(12, Math.min(this.width - 12, (position.x + 1) / 2 * this.width)), y = Math.max(24, Math.min(this.height - 8, (-position.y + 1) / 2 * this.height));
      label.style.left = `${x}px`; label.style.top = `${y}px`;
    }
  }
  private pick = (event: PointerEvent): void => {
    const start = this.pointer; this.pointer = null;
    if (!start || start.id !== event.pointerId || start.visual !== this.current || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 || !this.current) return;
    const bounds = this.stage.getBoundingClientRect(), ray = new Raycaster(); this.camera.updateMatrixWorld(); ray.setFromCamera(new Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    const match = ray.intersectObjects(this.current.meshes, false)[0]; if (typeof match?.object.userData.objectId === 'string') this.select(match.object.userData.objectId);
  };
  private orbit(horizontal: number, vertical: number): void {
    if (!this.current) return; const offset = this.camera.position.clone().sub(this.controls.target), spherical = new Spherical().setFromVector3(offset); spherical.theta += horizontal; spherical.phi = Math.max(.08, Math.min(Math.PI - .08, spherical.phi + vertical));
    this.camera.position.copy(this.controls.target).add(new Vector3().setFromSpherical(spherical)); this.camera.lookAt(this.controls.target); this.controls.update(); this.invalidate();
  }
  private zoom(factor: number): void { if (!this.current) return; const offset = this.camera.position.clone().sub(this.controls.target), length = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor)); this.camera.position.copy(this.controls.target).add(offset.setLength(length)); this.controls.update(); this.invalidate(); }
  private reset(): void { if (!this.current) return; this.fit(this.camera, this.controls.target, this.current.bounds, true); this.controls.update(); this.invalidate(); }
  private focusSelected(): void { const object = this.selected ? this.current?.objects.get(this.selected) : null; if (!object) return; this.fit(this.camera, this.controls.target, new Box3().setFromObject(object), false); this.controls.update(); this.invalidate(); }
  private keyboard = (event: KeyboardEvent): void => {
    if (event.target !== this.stage || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const operations: Record<string, () => void> = { ArrowLeft: () => this.orbit(-.18, 0), ArrowRight: () => this.orbit(.18, 0), ArrowUp: () => this.orbit(0, -.15), ArrowDown: () => this.orbit(0, .15), '+': () => this.zoom(.8), '=': () => this.zoom(.8), '-': () => this.zoom(1.25), Home: () => this.reset() };
    if (operations[event.key]) { event.preventDefault(); event.stopPropagation(); operations[event.key]!(); }
  };
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.cancelFrame(); this.cancelPending(); this.lifetime.abort(); this.resize.disconnect(); this.media.removeEventListener('change', this.preference);
    this.controls.removeEventListener('change', this.changed); this.controls.removeEventListener('start', this.started); this.controls.removeEventListener('end', this.started); this.controls.dispose(); this.disposeSelectionBox(); this.current?.dispose(); this.current = null; this.tags.clear(); this.engine.dispose(); this.root.remove();
  }
}

export function createViewer3D(container: HTMLElement, options: { onHide(): void }): VisualViewer { return new ExplanationViewer(container, options); }
