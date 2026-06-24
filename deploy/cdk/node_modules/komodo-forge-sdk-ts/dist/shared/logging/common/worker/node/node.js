// Node.js worker_threads script — runs as a worker thread on the server.
// Referenced via: new Worker(new URL('./worker/node.js', import.meta.url))
import { parentPort } from 'worker_threads';
import { createWorkerLogic } from '../shared/shared.js';
const port = parentPort;
if (!port)
    throw new Error('[komodo-logger] worker/node.ts must run as a worker_threads Worker');
const { handleMessage } = createWorkerLogic((msg) => port.postMessage(msg));
port.on('message', (data) => {
    handleMessage(data);
});
//# sourceMappingURL=node.js.map