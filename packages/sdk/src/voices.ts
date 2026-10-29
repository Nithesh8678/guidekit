/** Device/browser voices only. Quality ranking is a preference, not an audio-quality guarantee. */
export interface OutputPreference { voiceURI: string; language: string; rate: number; }
export interface VoiceSettingsState {
  available: boolean; voices: Array<{ id: string; label: string }>;
  selected: string; rate: number; message: string; previewing: boolean; recording: boolean; playable: boolean;
}
export interface VoiceSettingsHandlers { choose(id: string): void; rate(value: number): void; preview(): void; }
export const voicePreferenceKey = 'guidekit:voice:v1';
export function languageTag(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  try { return Intl.getCanonicalLocales(value.replaceAll('_', '-'))[0] ?? null; } catch { return null; }
}
export function voiceId(value: unknown): value is string { return typeof value === 'string' && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value); }
export function speechRate(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0.8 && value <= 1.2; }
export function readVoicePreference(value: unknown): OutputPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>, language = languageTag(item.language);
  return Object.keys(item).every(key => ['voiceURI', 'language', 'rate'].includes(key)) && voiceId(item.voiceURI) && language && speechRate(item.rate) ? { voiceURI: item.voiceURI, language, rate: item.rate } : null;
}
const novelty = /\b(?:albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|jester|junior|organ|princess|ralph|robot|superstar|trinoids|whisper|wobble|zarvox)\b/i;
const enhanced = /\b(?:natural|neural|enhanced|premium|siri)\b/i;
const familiar = /\b(?:samantha|daniel|karen|moira|tessa|rishi|veena|alex|ava|allison|serena|susan|tom|zoe)\b/i;
export function noveltyVoice(voice: SpeechSynthesisVoice): boolean { return novelty.test(voice.name); }
function score(voice: SpeechSynthesisVoice, language: string): number {
  const lang = languageTag(voice.lang)?.toLowerCase() ?? '', wanted = language.toLowerCase();
  return (lang === wanted ? 1000 : lang.split('-')[0] === wanted.split('-')[0] ? 850 : 0)
    + (enhanced.test(voice.name) ? 250 : /\b(?:google|microsoft)\b/i.test(voice.name) ? 120 : familiar.test(voice.name) ? 90 : 0)
    + (voice.default ? 20 : 0) - (noveltyVoice(voice) ? 10000 : 0);
}
export function orderedVoices(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice[] {
  const seen = new Set<string>();
  return voices.slice(0, 512).filter(voice => voice && voiceId(voice.voiceURI) && voice.voiceURI.length > 0 && typeof voice.name === 'string' && typeof voice.lang === 'string' && languageTag(voice.lang) && !seen.has(voice.voiceURI) && Boolean(seen.add(voice.voiceURI)))
    .sort((left, right) => score(right, language) - score(left, language) || left.name.localeCompare(right.name) || left.voiceURI.localeCompare(right.voiceURI)).slice(0, 160);
}
export function recommendedVoice(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null {
  const standard = orderedVoices(voices, language).filter(voice => !noveltyVoice(voice));
  return standard.find(voice => languageTag(voice.lang)?.split('-')[0] === language.split('-')[0]) ?? standard.find(voice => voice.default) ?? standard[0] ?? null;
}
