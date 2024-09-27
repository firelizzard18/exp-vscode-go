/* eslint-disable @typescript-eslint/no-unused-vars */
import { Box, Boxes } from './Boxes';
import { createElement } from './jsx';
import { LineData } from './messages';
import { FlameGraphSettings, postMessage, State } from './State';

interface Unit {
	powers: string[];
	divisor: number;
	threshold: number;
	precision?: number;
}

const Units: Record<string, Unit> = {
	count: { powers: [''], divisor: 1, threshold: Infinity },
	bytes: { powers: ['B', 'kiB', 'MiB', 'GiB', 'TiB'], divisor: 1024, threshold: 100, precision: 2 },
	nanoseconds: { powers: ['ns', 'µs', 'ms', 's'], divisor: 1000, threshold: 1000, precision: 3 },
};

interface Call {
	caller?: Func;
	callee?: Func;
	line?: Line;
	depth: number;
	sample: Sample;
}

interface BoxPlus extends Box {
	func?: Func;
	calls: Call[];
	cost: number;
}

export function FlameGraph({ profile }: { profile: Profile }) {
	const settings = State.flameGraph;
	if (settings.sample < 0) {
		const s =
			profile.SampleType.find((x) => x.Type === profile.DefaultSampleType) ||
			profile.SampleType.find((x) => x.Type === 'cpu') ||
			profile.SampleType[0];
		settings.sample = profile.SampleType.indexOf(s);
	}

	const graph = new CallGraph(profile, settings);
	let lineData = graph.lineData();
	let total = graph.totalCost();

	const initialBoxes = [...graph.down()];
	let focused = initialBoxes.find((x) => !x.func)!;

	const labelFor = (box: BoxPlus) => {
		const cost = box.calls?.reduce((sum, x) => sum + x.sample.Value[settings.sample], 0) ?? 0;
		return amountFor(profile.SampleType[settings.sample], cost, total);
	};

	const changeSample = () => {
		settings.sample = selectSample.el.selectedIndex;
		State.flameGraph = settings;
		lineData = graph.lineData();
		total = graph.totalCost();
		focus(focused);
	};

	const selectSample = (
		<select onchange={() => changeSample()}>
			{profile.SampleType.map((x, j) => (
				<option value={`${j}`} selected={settings.sample === j}>
					{x.Type}
				</option>
			))}
		</select>
	) as JSX.HTMLRenderable<HTMLSelectElement>;
	const centerLabel = (<span>{labelFor(focused)}</span>) as JSX.HTMLRenderable<HTMLSpanElement>;
	const rightLabel = (<span>&nbsp;</span>) as JSX.HTMLRenderable<HTMLSpanElement>;

	const boxes = (
		<Boxes
			focusColor="white"
			primaryColor="--vscode-charts-red"
			textColor="--vscode-editor-background"
			textColor2="--vscode-editor-foreground"
			boxes={initialBoxes}
			onHovered={(x) => ((boxes.hovered = x), hover(x))}
			onFocused={(x) => focus(x)}
		/>
	) as Boxes<BoxPlus>;
	const boxesDiv = (<div>{boxes}</div>) as JSX.HTMLRenderable<HTMLDivElement>;

	const hover = (box?: BoxPlus) => {
		if (box) {
			rightLabel.el.innerText = labelFor(focused);
		} else {
			rightLabel.el.innerHTML = '&nbsp;';
		}
		if (box?.func) {
			boxesDiv.el.dataset.vscodeContext = JSON.stringify({
				hoveredFunction: true,
			});
			postMessage({
				event: 'hovered',
				func: {
					file: box.func.Filename,
					line: box.func.StartLine,
				},
				lines: lineData.get(box.func),
			});
		} else {
			boxesDiv.el.dataset.vscodeContext = '{}';
			postMessage({
				event: 'hovered',
			});
		}
	};

	const focus = (box?: BoxPlus) => {
		if (!box) return;

		focused = box;
		settings.focused = box.func?.ID;
		State.flameGraph = settings;
		if (box.func) {
			centerLabel.el.innerHTML = '&nbsp;';
			boxes.boxes = [
				...graph.up(box.func),
				{
					label: labelFor(box),
					x1: 0,
					x2: 1,
					level: 0,
					group: -1,
					id: -1,
					alignLabel: 'center',
				} as BoxPlus,
				...graph.down(box.func),
			];
		} else {
			centerLabel.el.innerText = amountFor(profile.SampleType[settings.sample], total, total);
			boxes.boxes = [...graph.down(box.func)];
		}
	};

	if (settings.focused) {
		focus(initialBoxes.find((x) => x.func?.ID === settings.focused));
	}

	return (
		<div className="flame-graph">
			<div className="header">
				<span className="left">{selectSample}</span>
				<span className="center">{centerLabel}</span>
				<span className="right">{rightLabel}</span>
			</div>
			{boxesDiv}
		</div>
	);
}

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
		for (const sample of profile.Sample || []) {
			const funcs = sample.Location.slice()
				.reverse()
				.flatMap((l) => this.#locations.get(l)!.Line.slice().reverse())
				.map((l) => ({ line: l, func: this.#functions.get(l.Function)! }));

			let last: (typeof funcs)[0] | undefined;
			funcs.forEach(({ func, line }, depth) => {
				const call: Call = { callee: func, sample, depth, line: last?.line };
				if (last) call.caller = last.func;
				last = { func, line };
				this.#add(call);
			});
			if (last) {
				this.#add({ caller: last.func, line: last.line, sample, depth: funcs.length });
			}
		}
	}

	readonly to = (func: Func) => this.#for(func).to;
	readonly from = (func: Func) => this.#for(func).from;
	readonly entries = () => this.#for().from;
	readonly exits = () => this.#for().to;
	readonly totalCost = () => this.#profile.Sample?.reduce((sum, x) => sum + x.Value[this.#settings.sample], 0) ?? 1;
	readonly lineData = () => new Map([...this.#functions.values()].map((x) => [x, this.#lineDataFor(x)]));

	get functions() {
		return this.#functions.values();
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
	const { powers, divisor, threshold, precision } = Units[typ.Unit];
	while (value > threshold && power < powers.length) power++, (value /= divisor);
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
