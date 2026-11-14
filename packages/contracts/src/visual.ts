import { z } from 'zod';

const visualId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const position = z.tuple([z.number().finite().min(-20).max(20), z.number().finite().min(-20).max(20), z.number().finite().min(-20).max(20)]);
const rotation = z.tuple([z.number().finite().min(-6.284).max(6.284), z.number().finite().min(-6.284).max(6.284), z.number().finite().min(-6.284).max(6.284)]);
const size = z.tuple([z.number().finite().min(.05).max(12), z.number().finite().min(.05).max(12), z.number().finite().min(.05).max(12)]);

/** Procedural explanation data only. No code, assets, URLs, shaders or textures. */
export const visualObjectSchema = z.object({
  id: visualId, label: z.string().min(1).max(80), description: z.string().max(400),
  shape: z.enum(['box', 'sphere', 'cylinder', 'cone', 'torus', 'arrow']),
  position, rotation, size, color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
}).strict();
export const visualSceneSchema = z.object({
  kind: z.literal('scene3d'), id: visualId, title: z.string().min(1).max(120),
  summary: z.string().min(1).max(1200), objects: z.array(visualObjectSchema).min(1).max(36),
  focusId: visualId.nullable()
}).strict().superRefine((scene, ctx) => {
  const ids = new Set<string>();
  for (const [index, object] of scene.objects.entries()) {
    if (ids.has(object.id)) ctx.addIssue({ code: 'custom', path: ['objects', index, 'id'], message: 'Visual object IDs must be unique.' });
    ids.add(object.id);
  }
  if (scene.focusId && !ids.has(scene.focusId)) ctx.addIssue({ code: 'custom', path: ['focusId'], message: 'Focus must identify an object in this scene.' });
  if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > 24000) ctx.addIssue({ code: 'custom', message: 'The visual scene is too large.' });
});
export type VisualObject = z.infer<typeof visualObjectSchema>;
export type VisualScene = z.infer<typeof visualSceneSchema>;

const vectorOutput = (minimum: number, maximum: number) => ({ type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum, maximum } });
/** Strict provider schema mirrors the independently checked runtime contract. */
export const visualSceneOutputSchema = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'id', 'title', 'summary', 'objects', 'focusId'],
  properties: {
    kind: { type: 'string', enum: ['scene3d'] }, id: { type: 'string', minLength: 1, maxLength: 80 },
    title: { type: 'string', minLength: 1, maxLength: 120 }, summary: { type: 'string', minLength: 1, maxLength: 1200 },
    focusId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }] },
    objects: { type: 'array', minItems: 1, maxItems: 36, items: {
      type: 'object', additionalProperties: false, required: ['id', 'label', 'description', 'shape', 'position', 'rotation', 'size', 'color'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 80 }, label: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', maxLength: 400 },
        shape: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone', 'torus', 'arrow'] },
        position: vectorOutput(-20, 20), rotation: vectorOutput(-6.284, 6.284), size: vectorOutput(.05, 12), color: { type: 'string', minLength: 7, maxLength: 7 }
      }
    } }
  }
} as const;
