import {
	TestController,
	tests,
	ExtensionContext,
	commands,
	ExtensionMode,
	workspace,
	window,
	TextDocument,
	Range,
	TestTag,
	Uri,
	TestRunProfileKind,
	TestRunRequest,
	CancellationToken,
	Location,
	TestItem,
	TestRun,
} from 'vscode';
import { Context, doSafe, helpers } from '../utils/testing';
import { debugProcess, Flags, spawnProcess } from '../test/utils';
import { GoExtensionAPI } from '../vscode-go';
import { basename, dirname } from 'node:path';
import { TestConfig } from '../test/config';

export class GoGenerateManager {
	static async register(ctx: ExtensionContext, go: GoExtensionAPI) {
		const testCtx: Context = {
			workspace,
			go,
			spawn: spawnProcess,
			debug: debugProcess,
			testing: ctx.extensionMode === ExtensionMode.Test,
			state: ctx.workspaceState,
			storageUri: ctx.storageUri,
			output: window.createOutputChannel('Go Generate', { log: true }),
			commands: {
				modules: (args) => commands.executeCommand('gopls.modules', args),
				packages: (args) => commands.executeCommand('gopls.packages', args),
			},
		};
		const { event } = helpers(ctx, testCtx, commands);

		const ctrl = tests.createTestController('go-generate', 'Go Generate');
		const manager = new this(ctrl, testCtx);
		ctx.subscriptions.push(ctrl);

		// [Event] File open
		event(workspace.onDidOpenTextDocument, 'opened document', (e) => manager.#didOpen(e));

		// [Event] Files deleted
		event(workspace.onDidDeleteFiles, 'deleted file', (e) => manager.#didDelete(e.files));

		// [Event] File change
		event(workspace.onDidChangeTextDocument, 'updated document', async (e) => {
			// Ignore events that don't include changes. I don't know what
			// conditions trigger this, but we only care about actual changes.
			if (e.contentChanges.length === 0) {
				return;
			}

			await manager.#didOpen(e.document);
		});

		await doSafe(testCtx, 'open document', async () => {
			for (const doc of workspace.textDocuments) {
				await manager.#didOpen(doc);
			}
		});
	}

	readonly #ctrl: TestController;
	readonly #context: Context;

	constructor(ctrl: TestController, ctx: Context) {
		this.#ctrl = ctrl;
		this.#context = ctx;

		ctrl.createRunProfile('Go Generate', TestRunProfileKind.Run, (req, token) =>
			this.#run(req, TestRunProfileKind.Run, token),
		);
		ctrl.createRunProfile('Go Generate', TestRunProfileKind.Debug, (req, token) =>
			this.#run(req, TestRunProfileKind.Debug, token),
		);
	}

	async #didOpen(e: TextDocument) {
		if (e.languageId !== 'go' || e.uri.scheme !== 'file') {
			return;
		}

		const items = [];
		for (const match of e.getText().matchAll(/^\/\/go:generate go run ([^\n]*)\r?$/gm)) {
			const [full, expr] = match;
			console.log(expr);
			const start = e.positionAt(match.index);
			const end = e.positionAt(match.index + full.length);
			const item = this.#ctrl.createTestItem(`${e.uri}#L${start.line}`, `go run ${expr}`, e.uri);
			item.range = new Range(start, end);
			item.tags = [new TestTag('hidden')];
			item.sortText = expr;
			items.push(item);
		}

		if (items.length === 0) {
			this.#ctrl.items.delete(`${e.uri}`);
			return;
		}

		let file = this.#ctrl.items.get(`${e.uri}`);
		if (!file) {
			file = this.#ctrl.createTestItem(`${e.uri}`, basename(e.fileName), e.uri);
			this.#ctrl.items.add(file);
		}
		file.children.replace(items);
	}

	async #didDelete(files: readonly Uri[]) {
		for (const uri of files) {
			this.#ctrl.items.delete(`${uri}`);
		}
	}

	async #run(request: TestRunRequest, kind: TestRunProfileKind, token: CancellationToken) {
		const run = this.#ctrl.createTestRun(request);
		try {
			for (const item of request.include ?? []) {
				if (!item.sortText) continue;

				run.started(item);
				const cfg = new TestConfig(this.#context.workspace, item.uri!);
				const env = cfg.toolsEnvVars();
				const { flags, args } = parse(item.sortText, env);
				const { code } = await (kind === TestRunProfileKind.Debug ? this.#context.debug : this.#context.spawn)(
					this.#context,
					{
						run,
						testItem: item,
						uri: item.uri!,
						append: (...args) => append(run, ...args),
					},
					flags,
					{},
					args,
					{
						mode: 'run',
						cwd: dirname(item.uri!.fsPath),
						env,
						cancel: token,
						stdout: (s: string | null) => {
							if (!s) return;
							this.#context.output.debug(`stdout> ${s}`);
							append(run, s, undefined, item);
						},
						stderr: (s: string | null) => {
							if (!s) return;
							this.#context.output.debug(`stderr> ${s}`);
							append(run, s, undefined, item);
						},
					},
				);
				if (typeof code !== 'number') {
					run.skipped(item);
				} else if (code === 0) {
					run.passed(item);
				} else {
					run.failed(item, []);
				}
			}
		} finally {
			run.end();
		}
	}
}

function append(run: TestRun, output: string, location?: Location, test?: TestItem) {
	if (!output.endsWith('\n')) output += '\n';
	output = output.replace(/\n/g, '\r\n');
	run.appendOutput(output, location, test);
}

const flagsWithArgs = new Set([
	'-exec',
	'-C',
	'-p',
	'-covermode',
	'-coverpkg',
	'-asmflags',
	'-buildmode',
	'-compiler',
	'-gccgoflags',
	'-gcflags',
	'-installsuffix',
	'-ldflags',
	'-mod',
	'-modfile',
	'-overlay',
	'-pgo',
	'-pkgdir',
	'-tags',
	'-toolexec',
]);

function parse(line: string, vars: Record<string, string>) {
	const words: string[] = [];
	words: for (;;) {
		line = line.replace(/^[ \t]+/, '');
		if (!line.length) break;

		if (line[0] === '"') {
			for (let i = 1; i < line.length; i++) {
				switch (line[i]) {
					case '\\':
						if (i + 1 === line.length) {
							throw new Error('Bad backslash');
						}
						i++; // skip next character
						break;

					case '"': {
						// Not identical to strconv.Unquote but close enough
						const word = JSON.parse(line.slice(0, i + 1));
						words.push(word);
						line = line.slice(i + 1);

						if (line.length && line[0] !== ' ' && line[0] !== '\t') {
							throw new Error('Expect space after quoted argument');
						}
						continue words;
					}
				}
			}
		}

		let i = line.search(/[ \t]/);
		if (i < 0) {
			i = line.length;
		}

		words.push(line.slice(0, i));
		line = line.slice(i);
	}

	// Expand variables
	for (const i in words) {
		words[i] = words[i].replace(/\${(\w+)}|\$(\w+)/g, (_, braced, simple) => {
			const key = braced || simple;
			return vars[key] ?? process.env[key] ?? '';
		});
	}

	let i = 0;
	const flags: Flags = {};
	for (; i < words.length; i++) {
		const arg = words[i];
		if (arg === '--') {
			i++;
			break;
		}
		if (!arg.startsWith('-')) {
			break;
		}

		const [flag, value] = arg.split('=', 2);
		if (value) {
			flags[flag] = value;
		} else if (!flagsWithArgs.has(flag)) {
			flags[flag] = true;
		} else if (i + 1 === words.length) {
			break;
		} else {
			flags[flag] = words[i + 1];
			i++;
		}
	}

	return { flags, args: words.slice(i) };
}
