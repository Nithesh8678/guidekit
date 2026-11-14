import assert from 'node:assert/strict';
import test from 'node:test';
import type { VisualScene } from '../../contracts/src/index';
import { matchVisualFocus } from '../src/visual-focus';

const object = (id: string, label: string) => ({ id, label, description: 'Validated description.', shape: 'box' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number], color: '#112233' });
const scene: VisualScene = { kind: 'scene3d', id: 'rocket', title: 'Rocket', summary: 'Rocket parts.', focusId: null, objects: [object('engine', 'Rocket engine'), object('fuel_tanks', 'Fuel tanks')] };

test('local visual focus recognizes only explicit uniquely grounded object commands', () => {
  for (const command of ['Focus the engine', 'show me the rocket engine', 'highlight fuel tanks', 'select fuel_tanks.', 'Please focus on the Fuel tanks!']) {
    assert.equal(matchVisualFocus(command, scene)?.id, command.toLowerCase().includes('engine') ? 'engine' : 'fuel_tanks');
  }
  for (const command of ['Explain how the engine produces thrust and highlight it', 'How does the engine work?', 'focus the engine and save', 'focus engine then explain', 'show me why engine', 'show me the cabin', 'delete the engine', 'focus <script>', 'engine', 'focus']) assert.equal(matchVisualFocus(command, scene), null, command);
  const ambiguous = { ...scene, objects: [...scene.objects, object('second_engine', 'Second engine')] };
  assert.equal(matchVisualFocus('Focus the engine', ambiguous), null);
  assert.equal(matchVisualFocus('Focus the rocket engine', ambiguous)?.id, 'engine');
});
