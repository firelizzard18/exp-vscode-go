/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Box, Boxes } from './Boxes';
import { createElement } from './jsx';
import { FlameGraphSettings, LineData } from './messages';
import { addMessageListener, sendMessage, State } from './State';

interface Unit {
	powers: string[]; //   B, kB, MB
	divisor: number; //    1000 or 1024
	precision?: number; // The number of digits to show (omit to show all)
}

/**
 * Defines how to translate a given metric into a more human-friendly form.
 */
const Units: Record<string, Unit> = {
	count: { powers: [''], divisor: 1 },
	bytes: { powers: ['B', 'kiB', 'MiB', 'GiB', 'TiB'], divisor: 1024, precision: 2 },
	nanoseconds: { powers: ['ns', 'µs', 'ms', 's'], divisor: 1000, precision: 3 },
};

/**
 * An edge in the call graph.
 */
interface Call {
	/**
	 * The function making the call. Omitted for entry points.
	 */
	caller?: Func;

	/**
	 * The function being called. Omitted for the last function in a call stack.
	 */
	callee?: Func;

	/**
	 * The line of the call.
	 */
	line?: Line;

	/**
	 * The depth of the call in the call stack.
	 */
	depth: number;

	/**
	 * The associated sample.
	 */
	sample: Sample;
}

/**
 * A {@link Box} plus associated metadata.
 */
interface BoxPlus extends Box {
	/**
	 * The function associated with the box. Omitted for the root box.
	 */
	func?: Func;

	/**
	 * The set of samples (by way of {@link Call}s) that are aggregated into this box.
	 */
	calls: Call[];

	/**
	 * The total cost of the box.
	 */
	cost: number;
}

/**
 * Renders a profile as a flame graph.
 */
export function FlameGraph({ profile }: { profile: Profile }) {
	/**
	 * Line data for VSCode.
	 */
	let lineData: Map<Func, LineData[]>;

	/**
	 * The total cost of the selected sample type.
	 */
	let total: number;

	/**
	 * The flame graph boxes.
	 */
	let boxes: BoxPlus[];

	// Load settings from the webview's persistent state
	const settings = State.flameGraph;

	// Build the call graph
	const graph = new CallGraph(profile, settings);

	/**
	 * Applies a change to the settings.
	 * @param label - The label for the change (for undo).
	 * @param s - The changes to make.
	 */
	const applyChange = (label: string, s: Partial<FlameGraphSettings>) => {
		if (Object.keys(s).every((x) => (settings as any)[x] === (s as any)[x])) return;
		const before = Object.assign({}, settings);
		const after = Object.assign(settings, s);
		State.flameGraph = after;
		console.debug('Change', { before, after });
		sendMessage({ event: 'action', label, action: { action: 'flame-graph', before, after } });
		didChange(before);
	};

	/**
	 * Update the flame graph state.
	 * @param before - The settings prior to the change. Used for detecting which components of the state should be updated. Omit to update everything.
	 */
	const didChange = (before?: FlameGraphSettings) => {
		// Which settings changed?
		const changed = {
			sample: !before || before.sample !== settings.sample,
			ignored: !before || before.ignored.join(',') !== settings.ignored.join(','),
			focused: !before || before.focused !== settings.focused,
		} as const;

		// Save the new settings.
		State.flameGraph = settings;

		// If the sample type changed, recalculate line data and the total cost
		// and update the sample type selector.
		if (changed.sample) {
			lineData = graph.lineData();
			total = graph.totalCost();
			control.sample.el.selectedIndex = settings.sample;
		}

		// If the list of ignored functions changed, rebuild the call graph.
		if (changed.ignored) {
			graph.rebuild();
		}

		// If anything changed, re-render the boxes
		if (changed.sample || changed.ignored || changed.focused) {
			// Retrieve the focused function
			const func = typeof settings.focused === 'number' ? graph.function(settings.focused) : undefined;

			if (func) {
				// A function is focused.
				//
				// Clear the center label.
				label.center.el.innerHTML = '&nbsp;';

				// Walk the call graph down from the function and calculate its
				// total cost.
				const down = [...graph.down(func)];
				const cost = down[0].calls.reduce((sum, x) => sum + x.sample.Value[settings.sample], 0) ?? 0;

				boxes = [
					// Walk the call graph up from the function.
					...graph.up(func),

					// Add a label for the function's metrics.
					{
						label: amountFor(profile.SampleType[settings.sample], cost, total),
						x1: 0,
						x2: 1,
						level: 0,
						group: -1,
						id: -1,
						alignLabel: 'center',
					} as BoxPlus,

					// Include the walk down.
					...down,
				];
			} else {
				// The root is focused.
				//
				// Set the center label to the total.
				label.center.el.innerText = amountFor(profile.SampleType[settings.sample], total, total);

				// Walk the entire call graph (down from the root).
				boxes = [...graph.down()];
			}

			boxesEl.boxes = boxes;
		}
	};

	// Listen for events from VSCode
	//
	// TODO: Dispose listener if the element is removed from the DOM
	addMessageListener((msg) => {
		if (!('command' in msg)) return;
		switch (msg.command) {
			case 'undo': {
				// [Undo] Restore the previous settings and fire didChange
				const { before, after } = msg.action;
				Object.assign(settings, before);
				didChange(after);
				console.debug('Undo', { before, after });
				break;
			}

			case 'redo': {
				// [Redo] Restore the previously undone settings change and fire
				// didChange
				const { before, after } = msg.action;
				Object.assign(settings, after);
				didChange(before);
				console.debug('Redo', { after: before, before: after });
				break;
			}

			case 'ignore-func': {
				// Mark the given function as ignored (and rebuild the flame
				// graph)
				const func = graph.function(msg.func.id);
				if (!func) return;
				applyChange(`Ignore ${labelFor(func)}`, { ignored: [...settings.ignored, func.ID] });
				break;
			}
		}
	});

	const control = {
		// A <select> for changing the sample type
		sample: (
			<select onchange={() => applyChange('Change sample', { sample: control.sample.el.selectedIndex })}>
				{profile.SampleType.map((x, j) => (
					<option value={`${j}`} selected={settings.sample === j}>
						{x.Type}
					</option>
				))}
			</select>
		) as JSX.HTMLRenderable<HTMLSelectElement>,
	};

	const label = {
		center: (<span>&nbsp;</span>) as JSX.HTMLRenderable<HTMLSpanElement>,
		right: (<span>&nbsp;</span>) as JSX.HTMLRenderable<HTMLSpanElement>,
	} as const;

	const boxesEl = (
		<Boxes
			boxColor="--vscode-charts-red"
			textColor="--vscode-editor-background"
			textColor2="--vscode-editor-foreground"
			boxes={[] as BoxPlus[]}
			onHovered={(x) => hover(x)}
			onFocused={(x) => x && applyChange(`Focus ${labelFor(x.func)}`, { focused: x.func ? x.func.ID : null })}
		/>
	) as Boxes<BoxPlus>;
	const boxesDiv = (<div>{boxesEl}</div>) as JSX.HTMLRenderable<HTMLDivElement>;

	/**
	 * Handle hovering over a box.
	 */
	const hover = (box?: BoxPlus) => {
		// Update the left label with the cost of the hovered box, or clear it.
		if (box?.calls) {
			const cost = box.calls.reduce((sum, x) => sum + x.sample.Value[settings.sample], 0) ?? 0;
			label.right.el.innerText = amountFor(profile.SampleType[settings.sample], cost, total);
		} else {
			label.right.el.innerHTML = '&nbsp;';
		}

		// Update the VSCode context and inform the extension of the hovered box.
		if (box?.func) {
			boxesDiv.el.dataset.vscodeContext = JSON.stringify({
				hoveredFunction: true,
			});
			sendMessage({
				event: 'hovered',
				func: {
					id: box.func.ID,
					file: box.func.Filename,
					line: box.func.StartLine,
				},
				lines: lineData.get(box.func),
			});
		} else {
			boxesDiv.el.dataset.vscodeContext = '{}';
			sendMessage({
				event: 'hovered',
			});
		}
	};

	// Pick a default sample type. If the protocol specifies a default sample
	// type use that. If a sample type named "cpu" is present, use that.
	// Otherwise use the first sample type.
	if (settings.sample < 0) {
		const s =
			profile.SampleType.find((x) => x.Type === profile.DefaultSampleType) ||
			profile.SampleType.find((x) => x.Type === 'cpu') ||
			profile.SampleType[0];
		settings.sample = profile.SampleType.indexOf(s);
	}

	// Build the flame graph
	didChange();

	return (
		<div className="flame-graph">
			<div className="header">
				<span className="left">{control.sample}</span>
				<span className="center">{label.center}</span>
				<span className="right">{label.right}</span>
			</div>
			{boxesDiv}
		</div>
	);
}

/**
 * Constructs a call graph from the sample set.
 */
class CallGraph {
	readonly #profile: Profile;
	readonly #settings: FlameGraphSettings;
	readonly #functions: Map<number, Func>;
	readonly #locations: Map<number, Location>;
	readonly #calls = new Map<Func | undefined, { to: Call[]; from: Call[] }>();
	readonly #groups = new Map<string, number>();

	constructor(profile: Profile, settings: FlameGraphSettings) {
		this.#profile = profile;
		this.#settings = settings;

		this.#functions = new Map((profile.Function || []).map((f) => [f.ID, f]));
		this.#locations = new Map((profile.Location || []).map((l) => [l.ID, l]));
		this.rebuild();
	}

	readonly to = (func: Func) => this.#for(func).to;
	readonly from = (func: Func) => this.#for(func).from;
	readonly entries = () => this.#for().from;
	readonly exits = () => this.#for().to;
	readonly totalCost = () => this.#profile.Sample?.reduce((sum, x) => sum + x.Value[this.#settings.sample], 0) ?? 1;
	readonly lineData = () => new Map([...this.#functions.values()].map((x) => [x, this.#lineDataFor(x)]));
	readonly function = (id: number) => this.#functions.get(id);

	focused() {
		const { focused } = this.#settings;
		return typeof focused === 'number' ? this.function(focused) : undefined;
	}

	rebuild() {
		this.#calls.clear();
		for (const sample of this.#profile.Sample || []) {
			const funcs = sample.Location.slice()
				.reverse()
				.flatMap((l) => this.#locations.get(l)!.Line.slice().reverse())
				.map((l) => ({ line: l, func: this.#functions.get(l.Function)! }));

			if (funcs.some((x) => this.#settings.ignored.includes(x.func.ID))) continue;

			let last: (typeof funcs)[0] | undefined;
			let depth = 0;
			for (const { func, line } of funcs) {
				const call: Call = { callee: func, sample, depth, line: last?.line };
				if (last) call.caller = last.func;
				last = { func, line };
				this.#add(call);
				depth++;
			}
			if (last) {
				this.#add({ caller: last.func, line: last.line, sample, depth: funcs.length });
			}
		}
	}

	#add(call: Call) {
		this.#for(call.caller).from.push(call);
		this.#for(call.callee).to.push(call);

		for (const func of [call.caller, call.callee]) {
			if (func && !this.#groups.has(func.Filename)) {
				this.#groups.set(func.Filename, this.#groups.size + 1);
			}
		}
	}

	#for(func?: Func) {
		if (!this.#calls.has(func)) {
			this.#calls.set(func, { to: [], from: [] });
		}
		return this.#calls.get(func)!;
	}

	*down(func?: Func): Generator<BoxPlus> {
		const previous = func ? this.#firstCall(func, +1) : null;
		for (const x of this.#walk(this.#settings.sample, func, 1, 0, 1, previous, +1)) {
			yield {
				...x,
				label: labelFor(x.func),
				group: !x.func ? 0 : this.#groups.get(x.func.Filename)!,
				id: !x.func ? 0 : x.func.ID,
			};
		}
	}

	*up(func: Func): Generator<BoxPlus> {
		const previous = func ? this.#firstCall(func, -1) : null;
		let first = true;
		for (const x of this.#walk(this.#settings.sample, func, 0, 0, 1, previous, -1)) {
			if (first) {
				// Skip the first entry
				first = false;
			} else {
				yield {
					...x,
					label: labelFor(x.func),
					group: !x.func ? 0 : this.#groups.get(x.func.Filename)!,
					id: !x.func ? 0 : x.func.ID,
				};
			}
		}
	}

	#lineDataFor(func: Func) {
		const calls = groupBy(
			this.from(func).filter((x): x is Call & { line: Line } => !!x.line),
			(x) => x.line.Line,
		);
		const { sample } = this.#settings;
		const typ = this.#profile.SampleType[sample];
		const total = this.totalCost();
		const data = [...calls]
			.map(([line, calls]) => [line, calls.reduce((sum, x) => sum + x.sample.Value[sample], 0)] as const)
			.map(([line, cost]) => lineDataFor(typ, line, cost, total));

		const cost = this.from(func).reduce((sum, x) => sum + x.sample.Value[sample], 0);
		data.unshift(lineDataFor(typ, func.StartLine, cost, total));

		data.sort((a, b) => a.line - b.line);
		return data;
	}

	#firstCall(func: Func, dir: 1 | -1) {
		// Get *non-recursive* calls to func. That is, if a sample has multiple
		// calls to func (e.g. recursion), only include the topmost.
		const calls = dir > 0 ? this.to(func) : this.from(func);
		return calls.filter((x) => !calls.some((y) => x.depth > y.depth && x.sample === y.sample));
	}

	*#walk(
		value: number,
		func: Func | undefined,
		level: number,
		x1: number,
		x2: number,
		previous: Call[] | null,
		dir: 1 | -1,
	): Generator<{
		x1: number;
		x2: number;
		level: number;
		func?: Func;
		calls: Call[];
		cost: number;
	}> {
		let calls = !func ? this.entries() : dir > 0 ? this.from(func) : this.to(func);
		if (previous) {
			calls = calls.filter(({ sample: s1, depth: d1 }) =>
				previous.some(({ sample: s2, depth: d2 }) => s1 === s2 && d1 === d2 + dir),
			);
		}

		const cost = calls.reduce((sum, call) => sum + call.sample.Value[value], 0);
		yield {
			x1,
			x2,
			level,
			func,
			calls,
			cost,
		};

		let runningCost = 0;
		const w = x2 - x1;
		for (const [func, calls2] of groupBy(calls, dir > 0 ? (x) => x.callee : (x) => x.caller)) {
			const c1 = runningCost / cost;
			calls2.forEach((x) => (runningCost += x.sample.Value[value]));
			const c2 = runningCost / cost;
			if (func) {
				yield* this.#walk(value, func, level + dir, x1 + c1 * w, x1 + c2 * w, calls2, dir);
			} else if (dir < 0) {
				yield {
					x1: x1 + c1 * w,
					x2: x1 + c2 * w,
					level: level + dir,
					calls: calls2,
					cost: runningCost,
				};
			}
		}
	}
}

function powerOf(typ: ValueType, cost: number) {
	if (!(typ.Unit in Units)) throw new Error(`Unsupported unit ${typ.Unit}`);
	let value = cost;
	let power = 0;
	const { powers, divisor, precision } = Units[typ.Unit];
	while (precision && value > 10 ** precision && power < powers.length) power++, (value /= divisor);
	return { value: value.toPrecision(precision), unit: powers[power] };
}

function amountFor(typ: ValueType, cost: number, total: number) {
	const { value, unit } = powerOf(typ, cost);
	const percent = (cost / total) * 100;
	return `${value} ${unit} (${percent.toFixed(0)}%)`;
}

function labelFor(func?: Func) {
	if (!func) {
		return 'root';
	}

	let label = func.Name;

	// Remove generic parameters
	label = label.replace(/\[.*\]/, '');

	// Trim the domain, e.g. github.com/, gitlab.com/, etc
	let i = label.indexOf('/');
	label = label.substring(i + 1);

	i = label.substring(0, label.indexOf('.')).lastIndexOf('/');
	return label.substring(i + 1);
}

function groupBy<V, K>(items: V[], key: (item: V) => K): Map<K, V[]> {
	const groups = new Map<K, V[]>();
	for (const item of items) {
		const k = key(item);
		if (!groups.has(k)) {
			groups.set(k, []);
		}
		groups.get(k)!.push(item);
	}
	return groups;
}

function lineDataFor(typ: ValueType, line: number, cost: number, total: number): LineData {
	const { value, unit } = powerOf(typ, cost);
	return {
		line: line - 1, // vscode uses 0-based lines
		value,
		unit,
		ratio: ((cost / total) * 100).toFixed(0),
	};
}
