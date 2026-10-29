/** A deliberately bounded JSON Schema subset. Interprets data; never generates code. */
export type InputValidator = (value: unknown) => boolean;
type Schema = Record<string, unknown>;
const plain = (value: unknown): value is Schema => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'description', 'title', 'default', '$schema']);
const supported = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
function fail(): never { throw new Error('Use a bounded object JSON Schema with supported types, properties, required, enum and bounds. References, patterns and executable validation are not supported.'); }
const primitive = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

export function compileInputSchema(input: unknown): InputValidator {
  if (!plain(input) || input.type !== 'object') fail();
  const text = JSON.stringify(input); if (text.length > 6000) fail();
  const schema = JSON.parse(text) as Schema;
  let nodes = 0;
  function inspect(node: unknown, depth: number): asserts node is Schema {
    if (!plain(node) || ++nodes > 120 || depth > 6 || Object.keys(node).some(key => !keywords.has(key))) fail();
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.length || types.length > 2 || types.some(type => typeof type !== 'string' || !supported.has(type))) fail();
    for (const key of ['description', 'title', '$schema']) if (node[key] !== undefined && (typeof node[key] !== 'string' || (node[key] as string).length > 600)) fail();
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length < 1 || node.enum.length > 40 || !node.enum.every(primitive))) fail();
    if ('const' in node && !primitive(node.const)) fail();
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (node[key] !== undefined && (!Number.isInteger(node[key]) || Number(node[key]) < 0 || Number(node[key]) > (key.includes('Items') ? 100 : 10000))) fail();
    for (const key of ['minimum', 'maximum']) if (node[key] !== undefined && (typeof node[key] !== 'number' || !Number.isFinite(node[key]))) fail();
    if (node.minLength !== undefined && node.maxLength !== undefined && Number(node.minLength) > Number(node.maxLength)) fail();
    if (node.minItems !== undefined && node.maxItems !== undefined && Number(node.minItems) > Number(node.maxItems)) fail();
    if (node.minimum !== undefined && node.maximum !== undefined && Number(node.minimum) > Number(node.maximum)) fail();
    if (types.includes('object')) {
      if (node.additionalProperties !== undefined && node.additionalProperties !== false) fail();
      const properties = node.properties ?? {};
      if (!plain(properties) || Object.keys(properties).length > 40 || Object.keys(properties).some(key => forbidden.has(key) || key.length > 100)) fail();
      if (node.required !== undefined && (!Array.isArray(node.required) || node.required.length > 40 || !node.required.every(key => typeof key === 'string' && Object.hasOwn(properties, key)))) fail();
      for (const child of Object.values(properties)) inspect(child, depth + 1);
    } else if (node.properties !== undefined || node.required !== undefined || node.additionalProperties !== undefined) fail();
    if (types.includes('array')) inspect(node.items, depth + 1);
    else if (node.items !== undefined) fail();
  }
  inspect(schema, 0);
  return value => {
    let fuel = 1500;
    function check(node: Schema, data: unknown): boolean {
      if (--fuel < 0) return false;
      const types = Array.isArray(node.type) ? node.type : [node.type];
      const matches = types.some(type => type === 'null' ? data === null : type === 'object' ? plain(data) : type === 'array' ? Array.isArray(data) : type === 'integer' ? typeof data === 'number' && Number.isSafeInteger(data) : type === 'number' ? typeof data === 'number' && Number.isFinite(data) : typeof data === type);
      if (!matches || (Array.isArray(node.enum) && !node.enum.some(option => Object.is(option, data))) || ('const' in node && !Object.is(node.const, data))) return false;
      if (typeof data === 'string') return data.length <= Math.min(Number(node.maxLength ?? 10000), 10000) && data.length >= Number(node.minLength ?? 0);
      if (typeof data === 'number') return data >= Number(node.minimum ?? -Number.MAX_VALUE) && data <= Number(node.maximum ?? Number.MAX_VALUE);
      if (Array.isArray(data)) return data.length <= Math.min(Number(node.maxItems ?? 100), 100) && data.length >= Number(node.minItems ?? 0) && data.every(entry => check(node.items as Schema, entry));
      if (plain(data)) {
        const props = (node.properties ?? {}) as Record<string, Schema>;
        if (Object.keys(data).length > 40 || Object.keys(data).some(key => forbidden.has(key) || !Object.hasOwn(props, key))) return false;
        if (Array.isArray(node.required) && node.required.some(key => !Object.hasOwn(data, String(key)))) return false;
        return Object.entries(data).every(([key, entry]) => check(props[key], entry));
      }
      return true;
    }
    return check(schema, value);
  };
}
