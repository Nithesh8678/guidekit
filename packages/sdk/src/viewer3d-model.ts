import { AmbientLight, Box3, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group, Mesh, MeshLambertMaterial, Scene, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { visualSceneSchema, type VisualObject, type VisualScene } from '../../contracts/src/visual';

export interface PreparedVisual { spec: VisualScene; scene: Scene; objects: Map<string, Group>; meshes: Mesh[]; bounds: Box3; dispose(): void; }
/** A new topic resets the view. A same-topic update resets only on new explicit focus. */
export function visualCameraIntent(previous: VisualScene | null, next: VisualScene): 'reset' | 'focus' | 'preserve' {
  if (!previous || previous.id !== next.id) return 'reset';
  return next.focusId && next.focusId !== previous.focusId ? 'focus' : 'preserve';
}
export function visualFitDistance(radius: number, aspect: number, fieldOfView = 42): number {
  if (![radius, aspect, fieldOfView].every(Number.isFinite) || radius < 0 || aspect <= 0 || fieldOfView <= 0 || fieldOfView >= 160) throw new RangeError('Invalid explanation camera bounds.');
  const vertical = fieldOfView * Math.PI / 360, horizontal = Math.atan(Math.tan(vertical) * aspect);
  return Math.max(.7, radius) / Math.sin(Math.min(vertical, horizontal)) * 1.2;
}
function primitives(shape: VisualObject['shape']): { geometry: BufferGeometry; y: number }[] {
  switch (shape) {
    case 'box': return [{ geometry: new BoxGeometry(1, 1, 1), y: 0 }];
    case 'sphere': return [{ geometry: new SphereGeometry(.5, 20, 14), y: 0 }];
    case 'cylinder': return [{ geometry: new CylinderGeometry(.5, .5, 1, 20), y: 0 }];
    case 'cone': return [{ geometry: new ConeGeometry(.5, 1, 20), y: 0 }];
    case 'torus': return [{ geometry: new TorusGeometry(.34, .14, 10, 24), y: 0 }];
    case 'arrow': return [{ geometry: new CylinderGeometry(.065, .065, .7, 12), y: -.15 }, { geometry: new ConeGeometry(.18, .3, 16), y: .35 }];
  }
}
/** Every rendered mesh comes from validated procedural data, never a fixed demo. */
export function prepareVisual(input: unknown): PreparedVisual {
  const spec = visualSceneSchema.parse(input), scene = new Scene(), objects = new Map<string, Group>(), meshes: Mesh[] = [];
  const resources: { geometry: BufferGeometry; material: MeshLambertMaterial }[] = [];
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; for (const { geometry, material } of resources) { geometry.dispose(); material.dispose(); } scene.clear(); objects.clear(); meshes.length = 0; };
  try {
    scene.add(new AmbientLight(0xffffff, .72));
    const key = new DirectionalLight(0xffffff, 1.2); key.position.set(4, 7, 6); scene.add(key);
    const fill = new DirectionalLight(0xdce7ff, .36); fill.position.set(-5, 1, -3); scene.add(fill);
    for (const object of spec.objects) {
      const group = new Group(); group.name = object.id; group.userData.objectId = object.id;
      group.position.fromArray(object.position); group.rotation.set(...object.rotation); group.scale.fromArray(object.size);
      for (const primitive of primitives(object.shape)) {
        const material = new MeshLambertMaterial({ color: new Color(object.color) }); resources.push({ geometry: primitive.geometry, material });
        const mesh = new Mesh(primitive.geometry, material); mesh.position.y = primitive.y; mesh.userData.objectId = object.id; group.add(mesh); meshes.push(mesh);
      }
      objects.set(object.id, group); scene.add(group);
    }
    scene.updateMatrixWorld(true);
    const bounds = new Box3(); for (const object of objects.values()) bounds.union(new Box3().setFromObject(object));
    return { spec, scene, objects, meshes, bounds, dispose };
  } catch (error) { dispose(); throw error; }
}
