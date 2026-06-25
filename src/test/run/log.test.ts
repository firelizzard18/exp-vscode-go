/**
 * Unit tests for TestRunLog.
 *
 * Log data is synthesized inline. Each constant represents the stdout of a
 * `go test -json` run for a single scenario. The format is intentionally
 * close to real output so these constants can later be replaced by real log
 * files captured with `go test -json > testdata/<name>.log`.
 */
import { describe, expect, it } from '@jest/globals';
import { Location, TestMessage, Uri } from 'vscode';

import { type TestItem, type TestRun } from 'vscode';
import { TestRunLog } from './log';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(id: string, uri?: string, range?: [number, number]): TestItem {
	const item: Partial<TestItem> & { id: string } = {
		id,
		label: id,
		uri: uri ? Uri.file(uri) : undefined,
		range: undefined,
		parent: undefined,
		error: undefined,
		children: { get: () => undefined } as any,
		tags: [],
		canResolveChildren: false,
		busy: false,
	};
	if (range && uri) {
		const { Range, Position } = require('vscode');
		item.range = new Range(new Position(range[0], 0), new Position(range[1], 0));
	}
	return item as TestItem;
}

/** Records all TestRun calls for assertion. */
class RecordingRun {
	started: string[] = [];
	passed: string[] = [];
	failed: Array<{ id: string; messages: TestMessage[] }> = [];
	skipped: string[] = [];
	errored: Array<{ id: string; messages: any }> = [];
	output: Array<{ text: string; item?: string }> = [];
	ended = false;

	toTestRun(): TestRun {
		const r = this;
		return {
			started: (item: TestItem) => r.started.push(item.id),
			passed: (item: TestItem) => r.passed.push(item.id),
			failed: (item: TestItem, messages: any) =>
				r.failed.push({ id: item.id, messages: Array.isArray(messages) ? messages : [messages] }),
			skipped: (item: TestItem) => r.skipped.push(item.id),
			errored: (item: TestItem, messages: any) =>
				r.errored.push({ id: item.id, messages }),
			appendOutput: (text: string, _loc?: any, item?: TestItem) =>
				r.output.push({ text, item: item?.id }),
			enqueued: () => {},
			addCoverage: () => {},
			end: () => { r.ended = true; },
			name: 'recording',
			token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
			isPersisted: true,
			onDidDispose: () => ({ dispose: () => {} }),
		} as unknown as TestRun;
	}
}

function makeLog(recording: RecordingRun, defaultItem: TestItem, resolver?: (q: any) => TestItem | undefined) {
	return new TestRunLog(recording.toTestRun(), defaultItem, resolver ?? (() => undefined));
}

// ─── Synthesized log data ─────────────────────────────────────────────────────
//
// Each array below represents the stdout of `go test -json` for a scenario.
// Replace with real files from `go test -json > testdata/<name>.log` as needed.

const passSingleTest = [
	`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"=== RUN   TestFoo\\n"}`,
	`{"Action":"pass","Test":"TestFoo","Package":"foo","Elapsed":0.001}`,
];

const failSingleTest = [
	`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"=== RUN   TestFoo\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"    foo_test.go:10: want: 1\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"        got: 2\\n"}`,
	`{"Action":"fail","Test":"TestFoo","Package":"foo","Elapsed":0.002}`,
];

const skipSingleTest = [
	`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"=== RUN   TestFoo\\n"}`,
	`{"Action":"skip","Test":"TestFoo","Package":"foo","Elapsed":0.000}`,
];

const nonJsonOutput = [
	`not json at all`,
	`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
	`{"Action":"pass","Test":"TestFoo","Package":"foo","Elapsed":0.001}`,
];

const buildFailOutput = [
	`{"Action":"build-output","Output":"# foo\\n"}`,
	`{"Action":"build-output","Output":"foo_test.go:5:2: undefined: bar\\n"}`,
	`{"Action":"build-fail"}`,
];

const panicOutput = [
	`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"=== RUN   TestFoo\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"panic: something went wrong\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"goroutine 1 [running]:\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"foo.TestFoo(...)\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"\\t/workspace/foo_test.go:10 +0x58\\n"}`,
	`{"Action":"fail","Test":"TestFoo","Package":"foo","Elapsed":0.005}`,
];

const wantGotOutput = [
	`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"=== RUN   TestFoo\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"    foo_test.go:10: Unexpected result\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"        want: hello\\n"}`,
	`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"        got: world\\n"}`,
	`{"Action":"fail","Test":"TestFoo","Package":"foo","Elapsed":0.002}`,
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TestRunLog', () => {
	const pkgItem = makeItem('pkg', '/workspace');
	const testItem = makeItem('testfoo', '/workspace/foo_test.go', [8, 15]);

	describe('event routing', () => {
		it('routes pass', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of passSingleTest) log.onStdout(line + '\n');

			expect(rec.started).toContain('testfoo');
			expect(rec.passed).toContain('testfoo');
			expect(rec.failed).toHaveLength(0);
		});

		it('routes skip', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of skipSingleTest) log.onStdout(line + '\n');

			expect(rec.skipped).toContain('testfoo');
			expect(rec.passed).toHaveLength(0);
		});

		it('routes fail', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of failSingleTest) log.onStdout(line + '\n');

			expect(rec.failed).toHaveLength(1);
			expect(rec.failed[0].id).toBe('testfoo');
		});

		it('routes unknown test output to default item', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem);

			for (const line of passSingleTest) log.onStdout(line + '\n');

			// The resolver returns undefined so output goes to the package item.
			expect(rec.started).toContain('pkg');
		});

		it('passes non-JSON lines to appendOutput', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of nonJsonOutput) log.onStdout(line + '\n');

			const texts = rec.output.map((x) => x.text);
			expect(texts.some((t) => t.includes('not json'))).toBe(true);
		});
	});

	describe('build failures', () => {
		it('sets buildFailed and reports errored', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem);

			for (const line of buildFailOutput) log.onStdout(line + '\n');

			expect(log.buildFailed).toBe(true);
			// At least one errored call should have been made
			expect(rec.errored.length).toBeGreaterThan(0);
		});
	});

	describe('failure message parsing', () => {
		it('produces a diff message for want/got output', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of wantGotOutput) log.onStdout(line + '\n');

			expect(rec.failed).toHaveLength(1);
			const msgs = rec.failed[0].messages as TestMessage[];
			// Should have produced a diff message, not a plain string message
			const hasDiff = msgs.some((m) => m instanceof TestMessage && 'expectedOutput' in m);
			expect(hasDiff).toBe(true);
		});

		it('extracts location from panic stack trace', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of panicOutput) log.onStdout(line + '\n');

			expect(rec.failed).toHaveLength(1);
			const msgs = rec.failed[0].messages as TestMessage[];
			expect(msgs.length).toBeGreaterThan(0);
			// The failure message should have a location pointing into the workspace
			const withLocation = msgs.find((m) => m.location instanceof Location);
			expect(withLocation).toBeDefined();
			expect(withLocation!.location!.uri.fsPath).toContain('/workspace');
		});
	});

	describe('location tracking', () => {
		const locationOutput = [
			`{"Action":"run","Test":"TestFoo","Package":"foo"}`,
			// First output line has a file:line prefix — location should be captured
			`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"/workspace/foo_test.go:12: first line\\n"}`,
			// Continuation (8-space indent) — should inherit the location and strip the indent
			`{"Action":"output","Test":"TestFoo","Package":"foo","Output":"        continued\\n"}`,
			`{"Action":"fail","Test":"TestFoo","Package":"foo","Elapsed":0.001}`,
		];

		it('strips 8-space prefix from continuation lines', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem, (q) => (q === 'TestFoo' ? testItem : undefined));

			for (const line of locationOutput) log.onStdout(line + '\n');

			const outputTexts = rec.output.map((o) => o.text);
			// The continuation text should appear without the 8-space indent
			expect(outputTexts.some((t) => t.includes('continued') && !t.startsWith('        '))).toBe(true);
		});
	});

	describe('stderr', () => {
		it('appends stderr to default item', () => {
			const rec = new RecordingRun();
			const log = makeLog(rec, pkgItem);

			log.onStderr('panic: runtime error\n');

			const texts = rec.output.map((o) => o.text);
			expect(texts.some((t) => t.includes('panic: runtime error'))).toBe(true);
		});
	});
});
