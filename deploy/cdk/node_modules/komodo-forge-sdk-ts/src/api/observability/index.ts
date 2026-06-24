// Observability helpers — health, metrics, graceful shutdown.
// Mirrors komodo-forge-sdk-go/http/handlers and server/server.go.

export type { HealthCheckResult } from '../../shared/http/handlers/health/index.js';
export { healthHandler, readinessHandler } from '../../shared/http/handlers/health/index.js';

// --- Graceful Shutdown ---

/** Registers SIGTERM/SIGINT handlers that call the provided cleanup function. */
export function onShutdown(cleanup: () => Promise<void>): void {
	const handle = (signal: string) => {
		console.log(JSON.stringify({ level: 'info', msg: `received ${signal}, shutting down` }));
		cleanup()
			.then(() => {
				process.exit(0);
			})
			.catch((err: unknown) => {
				console.error(JSON.stringify({ level: 'error', msg: 'shutdown error', error: String(err) }));
				process.exit(1);
			});
	};

	process.once('SIGTERM', () => {
		handle('SIGTERM');
	});
	process.once('SIGINT', () => {
		handle('SIGINT');
	});
}

// --- Simple metrics ---

interface Counter {
	count: number;
}
interface Gauge {
	value: number;
}
interface Histogram {
	values: number[];
	count: number;
	sum: number;
}

const _counters: Map<string, Counter> = new Map();
const _gauges: Map<string, Gauge> = new Map();
const _histograms: Map<string, Histogram> = new Map();

export const metrics = {
	/** Increments a named counter by delta (default 1). */
	counter(name: string, delta = 1): void {
		const c = _counters.get(name) ?? { count: 0 };
		c.count += delta;
		_counters.set(name, c);
	},

	/** Sets a named gauge to an absolute value. */
	gauge(name: string, value: number): void {
		_gauges.set(name, { value });
	},

	/** Records an observation into a named histogram. */
	histogram(name: string, value: number): void {
		const h = _histograms.get(name) ?? { values: [], count: 0, sum: 0 };
		h.values.push(value);
		h.count++;
		h.sum += value;
		_histograms.set(name, h);
	},

	/** Returns all metrics as a plain object for serialization or a /metrics endpoint. */
	snapshot(): Record<string, unknown> {
		const counters: Record<string, number> = {};
		for (const [k, v] of _counters) counters[k] = v.count;

		const gauges: Record<string, number> = {};
		for (const [k, v] of _gauges) gauges[k] = v.value;

		const histograms: Record<string, { count: number; sum: number; avg: number }> = {};
		for (const [k, h] of _histograms) {
			histograms[k] = { count: h.count, sum: h.sum, avg: h.count > 0 ? h.sum / h.count : 0 };
		}

		return {
			timestamp: new Date().toISOString(),
			uptime_sec: Math.floor(process.uptime()),
			memory: process.memoryUsage(),
			counters,
			gauges,
			histograms,
		};
	},

	/** Returns a Prometheus-compatible /metrics scrape body (text/plain). */
	prometheusText(): string {
		const lines: string[] = [];

		for (const [k, v] of _counters) {
			const safe = k.replace(/[^a-z0-9_]/gi, '_');
			lines.push(`# TYPE ${safe} counter`, `${safe} ${v.count}`);
		}
		for (const [k, v] of _gauges) {
			const safe = k.replace(/[^a-z0-9_]/gi, '_');
			lines.push(`# TYPE ${safe} gauge`, `${safe} ${v.value}`);
		}
		for (const [k, h] of _histograms) {
			const safe = k.replace(/[^a-z0-9_]/gi, '_');
			lines.push(`# TYPE ${safe} summary`, `${safe}_count ${h.count}`, `${safe}_sum ${h.sum}`);
		}

		return lines.join('\n') + '\n';
	},
};

/** HTTP handler for the /metrics endpoint. Returns Prometheus-formatted metrics. */
export function metricsHandler(_req?: Request): Response {
	return new Response(metrics.prometheusText(), {
		status: 200,
		headers: { 'Content-Type': 'text/plain; version=0.0.4' },
	});
}
