/**
 * Interfaces to support testing.
 */

import type vscode from 'vscode';
import { type ExtensionContext, type TestItem, type TestItemCollection } from 'vscode';

import { type Context } from '@/utils/common';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tail<T extends any[]> = T extends [any, ...infer Tail] ? Tail : never;

// Signatures used by the component test mock to allow tests to wait for events
// to be processed.
declare module 'vscode' {
	export interface EventEmitter<T> {
		fire(data: T): void | Promise<void>;
	}
}

export type TestController = Pick<
	vscode.TestController,
	| 'items'
	| 'createTestItem'
	| 'createRunProfile'
	| 'createTestRun'
	| 'dispose'
	| 'resolveHandler'
	| 'refreshHandler'
	| 'invalidateTestResults'
>;

export const helpers = (ctx: ExtensionContext, testCtx: Context, commands: typeof vscode.commands) => ({
	event: <T>(event: vscode.Event<T>, msg: string, fn: (e: T) => unknown) => {
		ctx.subscriptions.push(event((e) => doSafe(testCtx, msg, () => fn(e))));
	},
	command: (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			commands.registerCommand(name, (...args) => doSafe(testCtx, `executing ${name}`, () => fn(...args))),
		);
	},
});

export const doSafe = async <T>(
	ctx: Pick<Context, 'testing' | 'output' | 'window'>,
	msg: string,
	fn: () => T | Promise<T>,
) => {
	try {
		return await fn();
	} catch (error) {
		reportError(ctx, msg, error);
	}
};

export function reportError(
	ctx: Pick<Context, 'testing' | 'output' | 'window'>,
	label: string | undefined,
	error: unknown,
) {
	if (ctx.testing) {
		throw error;
	} else if (error instanceof Error) {
		ctx.output.error(
			`${label && `[${label}] `}Error: ${error.message}\n${(error.cause as Error)?.stack ?? error.stack}`,
		);
	} else {
		ctx.output.error(`Error: ${error}`);
	}
	if (label && ctx.window) {
		ctx.window.showErrorMessage(`Error while ${label}`, 'See Output').then((r) => {
			if (r) ctx.output.show();
		});
	}
}

const debugResolve = false;

export function debugViewTree(root: TestItemCollection, label: string) {
	if (!debugResolve) return;
	const s = [label];
	const add = (item: TestItem, indent: string) => {
		if (indent === '  ' && item.children.size > 2) {
			console.error('wtf');
		}
		s.push(`${indent}${item.label}`);
		for (const [, child] of item.children) {
			add(child, indent + '  ');
		}
	};
	for (const [, item] of root) {
		add(item, '  ');
	}
	console.log(s.join('\n'));
}
