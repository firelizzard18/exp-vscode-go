/* eslint-disable @typescript-eslint/no-unused-vars */
import { Box, Boxes } from './Boxes';
import { createElement } from './jsx';

export function FlameGraph({ profile }: { profile: Profile }) {
	const graph = new CallGraph();
	const functions = new Map((profile.Function || []).map((f) => [f.ID, f]));
	const location = new Map((profile.Location || []).map((l) => [l.ID, l]));
	for (const sample of profile.Sample || []) {
		const funcs = sample.Location.slice()
			.reverse()
			.flatMap((l) => location.get(l)!.Line.slice().reverse())
			.map((l) => functions.get(l.Function)!);

		let last: Func | undefined;
		funcs.forEach((func, depth) => {
			const call: Call = { callee: func, sample, depth };
			if (last) call.caller = last;
			last = func;
			graph.add(call);
		});
		graph.add({ caller: last, sample, depth: funcs.length });
	}

	let i = profile.SampleType.findIndex((x) => x.Type === profile.DefaultSampleType);
	if (i < 0) i = profile.SampleType.findIndex((x) => x.Type === 'cpu');
	if (i < 0) i = 0;
	const typ = profile.SampleType[i];
	const total = profile.Sample?.reduce((sum, x) => sum + x.Value[i], 0) ?? 1;
	const costOf = (box: BoxPlus) => box.calls?.reduce((sum, x) => sum + x.sample.Value[i], 0) ?? 0;

	const centerLabel = (<span>{amountFor(typ, total, total)}</span>) as JSX.HTMLRenderable<HTMLSpanElement>;
	const rightLabel = (<span>&nbsp;</span>) as JSX.HTMLRenderable<HTMLSpanElement>;
	const elem = (
		<Boxes
			focusColor="white"
			primaryColor="--vscode-charts-red"
			textColor="--vscode-editor-background"
			textColor2="--vscode-editor-foreground"
			boxes={[...graph.down(i)]}
			onHovered={(x) => ((elem.hovered = x), hover(x))}
			onFocused={(x) => focus(x)}
		/>
	) as Boxes<BoxPlus>;

	const hover = (box?: BoxPlus) => {
		if (box) rightLabel.el.innerText = amountFor(typ, costOf(box), total);
		else rightLabel.el.innerHTML = '&nbsp;';
	};

	const focus = (box?: BoxPlus) => {
		if (!box) return;

		if (box.func) {
			centerLabel.el.innerHTML = '&nbsp;';
			elem.boxes = [
				...graph.up(i, box.func),
				{
					label: amountFor(typ, costOf(box), total),
					x1: 0,
					x2: 1,
					level: 0,
					group: -1,
					id: -1,
					alignLabel: 'center',
				} as BoxPlus,
				...graph.down(i, box.func),
			];
		} else {
			centerLabel.el.innerText = amountFor(typ, total, total);
			elem.boxes = [...graph.down(i, box.func)];
		}
	};

	return (
		<div className="flame-graph">
			<div className="header">
				<span className="left" />
				<span className="center">{centerLabel}</span>
				<span className="right">{rightLabel}</span>
			</div>
			{elem}
		</div>
	);
}

interface Unit {
	powers: string[];
	divisor: number;
	threshold: number;
	precision: number;
}

const Units: Record<string, Unit> = {
	count: { powers: [''], divisor: 1, threshold: 1, precision: 1000 },
	bytes: { powers: ['B', 'kiB', 'MiB', 'GiB', 'TiB'], divisor: 1024, threshold: 100, precision: 2 },
	nanoseconds: { powers: ['ns', 'µs', 'ms', 's'], divisor: 1000, threshold: 1000, precision: 3 },
};

function amountFor(typ: ValueType, cost: number, total: number) {
	if (!(typ.Unit in Units)) throw new Error(`Unsupported unit ${typ.Unit}`);
	let value = cost;
	let power = 0;
	const { powers, divisor, threshold, precision } = Units[typ.Unit];
	while (value > threshold && power < powers.length) power++, (value /= divisor);

	const percent = (cost / total) * 100;
	return `${value.toPrecision(precision)} ${powers[power]} (${percent.toFixed(0)}%)`;
}

interface Call {
	caller?: Func;
	callee?: Func;
	depth: number;
	sample: Sample;
}

interface BoxPlus extends Box {
	func?: Func;
	calls: Call[];
	cost: number;
}

class CallGraph {
	readonly #calls = new Map<Func | undefined, { to: Call[]; from: Call[] }>();
	readonly #groups = new Map<string, number>();

	readonly to = (func: Func) => this.#for(func).to;
	readonly from = (func: Func) => this.#for(func).from;
	readonly entries = () => this.#for().from;
	readonly exits = () => this.#for().to;

	add(call: Call) {
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

	*down(value: number, func?: Func): Generator<BoxPlus> {
		const previous = func ? this.#firstCall(func, +1) : null;
		for (const x of this.#walk(value, func, 1, 0, 1, previous, +1)) {
			yield {
				...x,
				label: labelFor(x.func),
				group: !x.func ? 0 : this.#groups.get(x.func.Filename)!,
				id: !x.func ? 0 : x.func.ID,
			};
		}
	}

	*up(value: number, func: Func): Generator<BoxPlus> {
		const previous = func ? this.#firstCall(func, -1) : null;
		let first = true;
		for (const x of this.#walk(value, func, 0, 0, 1, previous, -1)) {
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
