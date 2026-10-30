import { useEffect, useState } from 'react';

interface SDKManifest { version: string; release: string; script: { path: string; integrity: string }; }
function manifest(value: unknown): SDKManifest {
  const data = value as SDKManifest | null;
  if (!data || typeof data.version !== 'string' || !/^[0-9][0-9A-Za-z.+-]{0,79}$/.test(data.version) || typeof data.release !== 'string' || !/^[a-f0-9]{24}$/.test(data.release) || data.script?.path !== `/sdk/releases/${data.release}/guidekit.js` || typeof data.script.integrity !== 'string' || !/^sha384-[A-Za-z0-9+/]{64}$/.test(data.script.integrity)) throw new Error('The SDK release manifest is incompatible.');
  return data;
}
export function useSDKRelease(endpoint: string | undefined) {
  const [state, setState] = useState<{ status: 'loading' | 'pinned' | 'fallback'; manifest?: SDKManifest }>({ status: 'loading' }), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!endpoint) return;
    let active = true; const controller = new AbortController(); setState({ status: 'loading' });
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(`${endpoint}/sdk/manifest.json`, { credentials: 'omit', cache: 'no-cache', signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('SDK release manifest unavailable.'); const result = manifest(await response.json()); if (active) setState({ status: 'pinned', manifest: result }); }).catch(() => { if (active) setState({ status: 'fallback' }); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [endpoint, attempt]);
  return { ...state, refresh: () => setAttempt(value => value + 1) };
}
