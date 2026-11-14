import type { VisualObject, VisualScene } from '../../contracts/src/index';

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:the|a|an) /, '');

/** A small local command grammar, deliberately separate from explanation intent. */
export function matchVisualFocus(message: string, scene: VisualScene): VisualObject | null {
  const command = message.trim().match(/^(?:please\s+)?(?:focus(?:\s+on)?|select|highlight|show\s+me)\s+([\p{L}\p{N} _'-]{1,90})[.!]?$/iu);
  if (!command) return null;
  const query = normalize(command[1]!);
  if (query.length < 2 || /\b(?:how|why|what|when|where|and|or|then|also|because|explain|delete|save|create|change|add|remove)\b/u.test(query)) return null;
  const matches = scene.objects.filter(object => [normalize(object.label), normalize(object.id)].some(label => label === query || label.endsWith(` ${query}`)));
  return matches.length === 1 ? matches[0]! : null;
}
