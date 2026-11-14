import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlHold } from '../src/control-hold';
const control = { key: 'Control', ctrlKey: true, isTrusted: true };
test('Control-only hold arms once, commits once on release, and never activates for a tap or shortcut chord', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let starts = 0, finishes = 0, cancels = 0;
  const hold = new ControlHold({ enabled: () => true, start: () => { starts++; return true; }, finish: () => { finishes++; }, cancel: () => { cancels++; } });
  try {
    hold.keydown(control); context.mock.timers.tick(119); hold.keyup(control); context.mock.timers.tick(1000); assert.equal(starts, 0);
    hold.keydown(control); context.mock.timers.tick(40); hold.keydown({ ...control, key: 'c' }); context.mock.timers.tick(500); hold.keyup(control); assert.equal(starts, 0);
    hold.keydown(control); hold.keydown({ ...control, repeat: true }); context.mock.timers.tick(120); assert.equal(starts, 1);
    hold.keyup(control); hold.keyup(control); assert.equal(finishes, 1); assert.equal(cancels, 0);
  } finally { hold.destroy(); context.mock.timers.reset(); }
});
test('a chord, pointer/composition/blur interruption or destroy discards a started capture instead of submitting', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let starts = 0, finishes = 0, cancels = 0;
  const hold = new ControlHold({ enabled: () => true, start: () => { starts++; return true; }, finish: () => { finishes++; }, cancel: () => { cancels++; } });
  try {
    for (const interrupt of [() => hold.keydown({ ...control, key: 'v' }), () => hold.keydown({ ...control, isComposing: true }), () => hold.cancel()]) {
      hold.keydown(control); context.mock.timers.tick(120); interrupt(); hold.keyup(control);
    }
    hold.keydown(control); context.mock.timers.tick(120); hold.destroy(); hold.keyup(control);
    assert.equal(starts, 4); assert.equal(cancels, 4); assert.equal(finishes, 0);
  } finally { hold.destroy(); context.mock.timers.reset(); }
});
test('inactive, untrusted, modified and superseded holds cannot start microphone work', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let enabled = false, starts = 0;
  const hold = new ControlHold({ enabled: () => enabled, start: () => { starts++; return false; }, finish: assert.fail, cancel: assert.fail });
  try {
    hold.keydown(control); enabled = true; context.mock.timers.tick(1000); assert.equal(starts, 0);
    hold.keydown({ ...control, isTrusted: false }); hold.keydown({ ...control, shiftKey: true }); context.mock.timers.tick(1000); assert.equal(starts, 0);
    hold.keydown(control); enabled = false; context.mock.timers.tick(120); hold.keyup(control); assert.equal(starts, 0);
  } finally { hold.destroy(); context.mock.timers.reset(); }
});

test('trusted wheel cancels an armed or held Control gesture without affecting finalization after release', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let starts = 0, finishes = 0, cancels = 0;
  const hold = new ControlHold({ enabled: () => true, start: () => { starts++; return true; }, finish: () => { finishes++; }, cancel: () => { cancels++; } });
  try {
    hold.wheel({ isTrusted: true }); assert.equal(cancels, 0);
    hold.keydown(control); context.mock.timers.tick(80); hold.wheel({ isTrusted: true }); context.mock.timers.tick(200); hold.keyup(control);
    assert.equal(starts, 0); assert.equal(finishes, 0); assert.equal(cancels, 0);
    hold.keydown(control); context.mock.timers.tick(120); hold.wheel({ isTrusted: false }); assert.equal(cancels, 0);
    hold.wheel({ isTrusted: true }); hold.wheel({ isTrusted: true }); hold.keyup(control);
    assert.equal(starts, 1); assert.equal(cancels, 1); assert.equal(finishes, 0);
    hold.keydown(control); context.mock.timers.tick(120); hold.keyup(control); hold.wheel({ isTrusted: true });
    assert.equal(starts, 2); assert.equal(finishes, 1); assert.equal(cancels, 1);
    hold.destroy(); hold.wheel({ isTrusted: true }); assert.equal(cancels, 1);
  } finally { hold.destroy(); context.mock.timers.reset(); }
});
