// Browser Web Worker script — runs in DedicatedWorkerGlobalScope.
// Bundler (Vite / webpack 5) must process this file as a worker entry point via:
//   new Worker(new URL('./worker/browser.js', import.meta.url), { type: 'module' })

import type { WorkerMessage } from '../shared/shared.js';
import { createWorkerLogic } from '../shared/shared.js';

const { handleMessage } = createWorkerLogic(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(msg) => (globalThis as any).postMessage(msg),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).onmessage = ({ data }: { data: WorkerMessage }) => {
	handleMessage(data);
};
