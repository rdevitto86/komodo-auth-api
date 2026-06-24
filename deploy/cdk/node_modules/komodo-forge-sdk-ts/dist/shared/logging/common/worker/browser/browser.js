// Browser Web Worker script — runs in DedicatedWorkerGlobalScope.
// Bundler (Vite / webpack 5) must process this file as a worker entry point via:
//   new Worker(new URL('./worker/browser.js', import.meta.url), { type: 'module' })
import { createWorkerLogic } from '../shared/shared.js';
const { handleMessage } = createWorkerLogic(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(msg) => globalThis.postMessage(msg));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.onmessage = ({ data }) => {
    handleMessage(data);
};
//# sourceMappingURL=browser.js.map