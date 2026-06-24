import { describe, expect, it } from 'vitest';
import type { BaseLogEvent } from './base.js';
import { formatEvent } from './format.js';

describe('Unit Tests', () => {
	const makeAndFormat = (overrides: Partial<BaseLogEvent> = {}, verbose: boolean = true): string =>
		formatEvent(
			{
				timestamp: '2026-04-12T00:00:00.000Z',
				level: 'warn',
				type: 'runtime',
				service: 'test-svc',
				env: 'development',
				version: '1.0.0',
				message: 'test message',
				...overrides,
			} as BaseLogEvent,
			verbose,
		);

	describe('formatEvent', () => {
		it('suppresses runtime debug in non-verbose mode', () => expect(makeAndFormat({ level: 'debug' }, false)).toBe(''));
		it('suppresses runtime info in non-verbose mode', () => expect(makeAndFormat({ level: 'info' }, false)).toBe(''));
		it('passes runtime warn through in non-verbose mode', () =>
			expect(makeAndFormat({ level: 'warn' }, false)).toContain('[WARN]'));
		it('passes runtime error through in non-verbose mode', () =>
			expect(makeAndFormat({ level: 'error' }, false)).toContain('[ERROR]'));
		it('suppresses clickstream events in non-verbose mode', () =>
			expect(makeAndFormat({ type: 'clickstream', level: 'info' }, false)).toBe(''));
		it('suppresses telemetry events in non-verbose mode', () =>
			expect(makeAndFormat({ type: 'telemetry', level: 'info' }, false)).toBe(''));
		it('suppresses interaction events in non-verbose mode', () =>
			expect(makeAndFormat({ type: 'interaction', level: 'info' }, false)).toBe(''));
		it('renders INFO label for runtime in verbose mode', () =>
			expect(makeAndFormat({ level: 'info' }, true)).toContain('[INFO]'));
		it('prefixes output with the ISO timestamp', () =>
			expect(makeAndFormat({}, true)).toContain('2026-04-12T00:00:00.000Z'));
		it('inlines multi-key details without embedded newlines', () =>
			expect(makeAndFormat({ details: { a: 1, b: 2, c: 3 } }, true)).not.toMatch(/\n/));
		it('omits the " | " section when details is absent', () => expect(makeAndFormat({}, true)).not.toContain('|'));

		it('renders DEBUG label for runtime in verbose mode', () => {
			const out = makeAndFormat({ level: 'debug' }, true);
			expect(out).toContain('[DEBUG]');
			expect(out).toContain('test message');
		});

		it('uses type name as label for non-runtime events in verbose mode', () => {
			expect(makeAndFormat({ type: 'clickstream', level: 'info' }, true)).toContain('[CLICKSTREAM]');
			expect(makeAndFormat({ type: 'telemetry', level: 'info' }, true)).toContain('[TELEMETRY]');
			expect(makeAndFormat({ type: 'interaction', level: 'info' }, true)).toContain('[INTERACTION]');
		});

		it('appends inlined JSON details after " | "', () => {
			const out = makeAndFormat({ details: { txId: 'abc', code: 42 } }, true);
			expect(out).toContain('| {');
			expect(out).toContain('"txId": "abc"');
			expect(out).toContain('"code": 42');
		});
	});
});
