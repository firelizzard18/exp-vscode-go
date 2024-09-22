/* eslint-disable @typescript-eslint/no-unused-vars */
import { Box, Boxes } from './Boxes';
import { createElement } from './jsx';

export function FlameGraph({ profile }: { profile: Profile }) {
	let i = profile.SampleType.findIndex((x) => x.Type === profile.DefaultSampleType);
	if (i < 0) i = 0;

	const functions = new Map((profile.Function || []).map((f) => [f.ID, f]));
	const location = new Map((profile.Location || []).map((l) => [l.ID, l]));

	const addTree = (sample: Sample, level: number, parent: Node, funcs?: Func[]) => {
		if (!funcs) {
			funcs = sample.Location.slice()
				.reverse()
				.flatMap((l) => location.get(l)!.Line.slice().reverse())
				.map((l) => functions.get(l.Function)!);
		}

		const v = sample.Value[i];
		parent.cost += v;
		if (level >= funcs.length) {
			parent.children.push(v);
			return;
		}

		const func = funcs[level];
		let node = parent.children.filter((n) => typeof n === 'object').find((n) => n.func === func);
		if (!node) {
			node = { func, cost: 0, children: [] };
			parent.children.push(node);
		}

		addTree(sample, level + 1, node);
	};

	const groups = new Map<string, number>();
	const group = (node: Node) => {
		if (!node.func) return 0;

		let g = groups.get(node.func.Filename);
		if (g !== undefined) return g;

		g = groups.size + 1;
		groups.set(node.func.Filename, g);
		return g;
	};

	const boxes: Box[] = [];
	const addBoxes = (node: Node, level: number, x1: number, x2: number) => {
		boxes.push({
			label: node.func ? labelFor(node.func) : 'root',
			x1,
			x2,
			level,
			group: group(node),
			id: node.func?.ID ?? 0,
		});

		let cost = 0;
		const w = x2 - x1;
		for (const child of node.children) {
			if (typeof child === 'number') {
				cost += child;
				continue;
			}
			const c1 = cost / node.cost;
			cost += child.cost;
			const c2 = cost / node.cost;
			addBoxes(child, level + 1, x1 + c1 * w, x1 + c2 * w);
		}
	};

	const tree: Node = { cost: 0, children: [] };
	profile.Sample?.forEach((s) => addTree(s, 0, tree));
	addBoxes(tree, 0, 0, 1);

	return (
		<div className="flame-graph">
			{/* <span>This is a flame graph</span> */}
			<Boxes
				focusColor="--vscode-focusBorder"
				primaryColor="--vscode-charts-red"
				textColor="--vscode-editor-background"
				boxes={boxes}
			/>
		</div>
	);
}

interface Node {
	func?: Func;
	cost: number;
	children: (Node | number)[];
}

function labelFor(func: Func) {
	let label = func.Name;

	// Trim the domain, e.g. github.com/, gitlab.com/, etc
	let i = label.indexOf('/');
	label = label.substring(i + 1);

	i = label.substring(0, label.indexOf('.')).lastIndexOf('/');
	return label.substring(i + 1);
}
