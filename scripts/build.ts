import { build as viteBuild } from 'vite';
import { buildSDK } from './build-sdk.js';
import { cp } from 'node:fs/promises';

const sdk = await buildSDK();
await viteBuild();
await cp('apps/demo', 'dist/demo', { recursive: true });
console.log(`Dashboard, reusable SDK ${sdk.version} (${sdk.release}), package/types, and independent demo sites built.`);
