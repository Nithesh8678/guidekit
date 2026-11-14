import type { VisualScene } from '../../packages/contracts/src/index.js';

/** Explicit synthetic scene for tests; production scenes come from inference. */
export function rocketScene(focusId: string | null = null): VisualScene {
  return { kind: 'scene3d', id: 'rocket', title: 'How a rocket works', summary: 'A conceptual rocket with a payload, body and engine. This illustration is not to scale.', focusId, objects: [
    { id: 'body', label: 'Fuel tanks', description: 'The tanks carry propellant for the engine.', shape: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 0], size: [1.4, 3.2, 1.4], color: '#C9D8E8' },
    { id: 'payload', label: 'Payload fairing', description: 'The nose protects the payload during ascent.', shape: 'cone', position: [0, 2.2, 0], rotation: [0, 0, 0], size: [1.4, 1.2, 1.4], color: '#466BBD' },
    { id: 'engine', label: 'Rocket engine', description: 'Expelled hot gas produces thrust.', shape: 'cone', position: [0, -2, 0], rotation: [3.14159, 0, 0], size: [1, 1.1, 1], color: '#E7AE49' }
  ] };
}
