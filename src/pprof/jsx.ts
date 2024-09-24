/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
	namespace JSX {
		// // We don't just because		//// historically does more than we need it to.
		// // E.g. it also contains .propTypes and so TS also verifies the declared
		// // props type does match the declared .propTypes.
		// // But if libraries declared their .propTypes but not props type,
		// // or they mismatch, you won't be able to use the class component
		// // as a JSX.ElementType.
		// // We could fix this everywhere but we're ultimately not interested in
		// // .propTypes assignability so we might as well drop it entirely here to
		// //  reduce the work of the type-checker.
		// // TODO: Check impact of making P= any> = P
		// type ElementType = string | any;
		// interface Element extends any any> {}
		// interface ElementClass extends any {
		// 	render():
		//}
		// interface ElementAttributesProperty {
		// 	props: {};
		// }
		// interface ElementChildrenAttribute {
		// 	children: {};
		// }

		// // We can't recurse forever because `type` can't be self-referential;
		// // let's assume it's reasonable to do a single )around a single )/ vice-versa
		// type LibraryManagedAttributes<C, P> = C extends
		// 	| inferT>
		// 	| inferT>
		// 	? T extends inferU> | inferU>
		// 		? ReactManagedAttributes<U, P>
		// 		: ReactManagedAttributes<T, P>
		// 	: ReactManagedAttributes<C, P>;

		// interface IntrinsicAttributes {}		// interface IntrinsicClassAttributes<T> extends T {}

		type Component<P, N extends Node, R extends Renderable<N>> = new (props: P) => R;
		type ParentComponent<P, N extends Node, R extends Renderable<N>, C extends Array<any>> = new (
			props: P,
			children: C,
		) => R;

		interface Renderable<N extends Node = Node> {
			render(): N | Renderable;
		}

		interface HTMLRenderable<T extends HTMLElement> extends Renderable<T> {
			el: T;
		}

		type Attributes<T extends Element> = Partial<T>;

		interface IntrinsicElements {
			// HTML
			a: Attributes<HTMLAnchorElement>;
			abbr: Attributes<HTMLElement>;
			address: Attributes<HTMLElement>;
			area: Attributes<HTMLAreaElement>;
			article: Attributes<HTMLElement>;
			aside: Attributes<HTMLElement>;
			audio: Attributes<HTMLAudioElement>;
			b: Attributes<HTMLElement>;
			base: Attributes<HTMLBaseElement>;
			bdi: Attributes<HTMLElement>;
			bdo: Attributes<HTMLElement>;
			big: Attributes<HTMLElement>;
			blockquote: Attributes<HTMLQuoteElement>;
			body: Attributes<HTMLBodyElement>;
			br: Attributes<HTMLBRElement>;
			button: Attributes<HTMLButtonElement>;
			canvas: Attributes<HTMLCanvasElement>;
			caption: Attributes<HTMLElement>;
			center: Attributes<HTMLElement>;
			cite: Attributes<HTMLElement>;
			code: Attributes<HTMLElement>;
			col: Attributes<HTMLTableColElement>;
			colgroup: Attributes<HTMLTableColElement>;
			data: Attributes<HTMLDataElement>;
			datalist: Attributes<HTMLDataListElement>;
			dd: Attributes<HTMLElement>;
			del: Attributes<HTMLModElement>;
			details: Attributes<HTMLDetailsElement>;
			dfn: Attributes<HTMLElement>;
			dialog: Attributes<HTMLDialogElement>;
			div: Attributes<HTMLDivElement>;
			dl: Attributes<HTMLDListElement>;
			dt: Attributes<HTMLElement>;
			em: Attributes<HTMLElement>;
			embed: Attributes<HTMLEmbedElement>;
			fieldset: Attributes<HTMLFieldSetElement>;
			figcaption: Attributes<HTMLElement>;
			figure: Attributes<HTMLElement>;
			footer: Attributes<HTMLElement>;
			form: Attributes<HTMLFormElement>;
			h1: Attributes<HTMLHeadingElement>;
			h2: Attributes<HTMLHeadingElement>;
			h3: Attributes<HTMLHeadingElement>;
			h4: Attributes<HTMLHeadingElement>;
			h5: Attributes<HTMLHeadingElement>;
			h6: Attributes<HTMLHeadingElement>;
			head: Attributes<HTMLHeadElement>;
			header: Attributes<HTMLElement>;
			hgroup: Attributes<HTMLElement>;
			hr: Attributes<HTMLHRElement>;
			html: Attributes<HTMLHtmlElement>;
			i: Attributes<HTMLElement>;
			iframe: Attributes<HTMLIFrameElement>;
			img: Attributes<HTMLImageElement>;
			input: Attributes<HTMLInputElement>;
			ins: Attributes<HTMLModElement>;
			kbd: Attributes<HTMLElement>;
			keygen: Attributes<HTMLElement>;
			label: Attributes<HTMLLabelElement>;
			legend: Attributes<HTMLLegendElement>;
			li: Attributes<HTMLLIElement>;
			link: Attributes<HTMLLinkElement>;
			main: Attributes<HTMLElement>;
			map: Attributes<HTMLMapElement>;
			mark: Attributes<HTMLElement>;
			menu: Attributes<HTMLElement>;
			menuitem: Attributes<HTMLElement>;
			meta: Attributes<HTMLMetaElement>;
			meter: Attributes<HTMLMeterElement>;
			nav: Attributes<HTMLElement>;
			noindex: Attributes<HTMLElement>;
			noscript: Attributes<HTMLElement>;
			object: Attributes<HTMLObjectElement>;
			ol: Attributes<HTMLOListElement>;
			optgroup: Attributes<HTMLOptGroupElement>;
			option: Attributes<HTMLOptionElement>;
			output: Attributes<HTMLOutputElement>;
			p: Attributes<HTMLParagraphElement>;
			param: Attributes<HTMLParamElement>;
			picture: Attributes<HTMLElement>;
			pre: Attributes<HTMLPreElement>;
			progress: Attributes<HTMLProgressElement>;
			q: Attributes<HTMLQuoteElement>;
			rp: Attributes<HTMLElement>;
			rt: Attributes<HTMLElement>;
			ruby: Attributes<HTMLElement>;
			s: Attributes<HTMLElement>;
			samp: Attributes<HTMLElement>;
			search: Attributes<HTMLElement>;
			slot: Attributes<HTMLSlotElement>;
			script: Attributes<HTMLScriptElement>;
			section: Attributes<HTMLElement>;
			select: Attributes<HTMLSelectElement>;
			small: Attributes<HTMLElement>;
			source: Attributes<HTMLSourceElement>;
			span: Attributes<HTMLSpanElement>;
			strong: Attributes<HTMLElement>;
			style: Attributes<HTMLStyleElement>;
			sub: Attributes<HTMLElement>;
			summary: Attributes<HTMLElement>;
			sup: Attributes<HTMLElement>;
			table: Attributes<HTMLTableElement>;
			template: Attributes<HTMLTemplateElement>;
			tbody: Attributes<HTMLTableSectionElement>;
			td: Attributes<HTMLTableDataCellElement>;
			textarea: Attributes<HTMLTextAreaElement>;
			tfoot: Attributes<HTMLTableSectionElement>;
			th: Attributes<HTMLTableHeaderCellElement>;
			thead: Attributes<HTMLTableSectionElement>;
			time: Attributes<HTMLTimeElement>;
			title: Attributes<HTMLTitleElement>;
			tr: Attributes<HTMLTableRowElement>;
			track: Attributes<HTMLTrackElement>;
			u: Attributes<HTMLElement>;
			ul: Attributes<HTMLUListElement>;
			var: Attributes<HTMLElement>;
			video: Attributes<HTMLVideoElement>;
			wbr: Attributes<HTMLElement>;
			// webview: AsJSX<HTMLWebViewElement>;

			// // SVG
			// svg: AsJSX<SVGSVGElement>;

			// animate: AsJSX<SVGElement>; // TODO: It is SVGAnimateElement but is not in TypeScript's lib.dom.d.ts for now.
			// animateMotion: AsJSX<SVGElement>;
			// animateTransform: AsJSX<SVGElement>; // TODO: It is SVGAnimateTransformElement but is not in TypeScript's lib.dom.d.ts for now.
			// circle: AsJSX<SVGCircleElement>;
			// clipPath: AsJSX<SVGClipPathElement>;
			// defs: AsJSX<SVGDefsElement>;
			// desc: AsJSX<SVGDescElement>;
			// ellipse: AsJSX<SVGEllipseElement>;
			// feBlend: AsJSX<SVGFEBlendElement>;
			// feColorMatrix: AsJSX<SVGFEColorMatrixElement>;
			// feComponentTransfer: AsJSX<SVGFEComponentTransferElement>;
			// feComposite: AsJSX<SVGFECompositeElement>;
			// feConvolveMatrix: AsJSX<SVGFEConvolveMatrixElement>;
			// feDiffuseLighting: AsJSX<SVGFEDiffuseLightingElement>;
			// feDisplacementMap: AsJSX<SVGFEDisplacementMapElement>;
			// feDistantLight: AsJSX<SVGFEDistantLightElement>;
			// feDropShadow: AsJSX<SVGFEDropShadowElement>;
			// feFlood: AsJSX<SVGFEFloodElement>;
			// feFuncA: AsJSX<SVGFEFuncAElement>;
			// feFuncB: AsJSX<SVGFEFuncBElement>;
			// feFuncG: AsJSX<SVGFEFuncGElement>;
			// feFuncR: AsJSX<SVGFEFuncRElement>;
			// feGaussianBlur: AsJSX<SVGFEGaussianBlurElement>;
			// feImage: AsJSX<SVGFEImageElement>;
			// feMerge: AsJSX<SVGFEMergeElement>;
			// feMergeNode: AsJSX<SVGFEMergeNodeElement>;
			// feMorphology: AsJSX<SVGFEMorphologyElement>;
			// feOffset: AsJSX<SVGFEOffsetElement>;
			// fePointLight: AsJSX<SVGFEPointLightElement>;
			// feSpecularLighting: AsJSX<SVGFESpecularLightingElement>;
			// feSpotLight: AsJSX<SVGFESpotLightElement>;
			// feTile: AsJSX<SVGFETileElement>;
			// feTurbulence: AsJSX<SVGFETurbulenceElement>;
			// filter: AsJSX<SVGFilterElement>;
			// foreignObject: AsJSX<SVGForeignObjectElement>;
			// g: AsJSX<SVGGElement>;
			// image: AsJSX<SVGImageElement>;
			// line: AsJSX<SVGLineElement>;
			// linearGradient: AsJSX<SVGLinearGradientElement>;
			// marker: AsJSX<SVGMarkerElement>;
			// mask: AsJSX<SVGMaskElement>;
			// metadata: AsJSX<SVGMetadataElement>;
			// mpath: AsJSX<SVGElement>;
			// path: AsJSX<SVGPathElement>;
			// pattern: AsJSX<SVGPatternElement>;
			// polygon: AsJSX<SVGPolygonElement>;
			// polyline: AsJSX<SVGPolylineElement>;
			// radialGradient: AsJSX<SVGRadialGradientElement>;
			// rect: AsJSX<SVGRectElement>;
			// set: AsJSX<SVGSetElement>;
			// stop: AsJSX<SVGStopElement>;
			// switch: AsJSX<SVGSwitchElement>;
			// symbol: AsJSX<SVGSymbolElement>;
			// text: AsJSX<SVGTextElement>;
			// textPath: AsJSX<SVGTextPathElement>;
			// tspan: AsJSX<SVGTSpanElement>;
			// use: AsJSX<SVGUseElement>;
			// view: AsJSX<SVGViewElement>;
		}
	}
}

type DOMFactory<T extends Element> = (
	props?: JSX.Attributes<T> | null,
	...children: JSX.Renderable[]
) => JSX.Renderable<T>;

interface HTMLTypes {
	a: DOMFactory<HTMLAnchorElement>;
	abbr: DOMFactory<HTMLElement>;
	address: DOMFactory<HTMLElement>;
	area: DOMFactory<HTMLAreaElement>;
	article: DOMFactory<HTMLElement>;
	aside: DOMFactory<HTMLElement>;
	audio: DOMFactory<HTMLAudioElement>;
	b: DOMFactory<HTMLElement>;
	base: DOMFactory<HTMLBaseElement>;
	bdi: DOMFactory<HTMLElement>;
	bdo: DOMFactory<HTMLElement>;
	big: DOMFactory<HTMLElement>;
	blockquote: DOMFactory<HTMLQuoteElement>;
	body: DOMFactory<HTMLBodyElement>;
	br: DOMFactory<HTMLBRElement>;
	button: DOMFactory<HTMLButtonElement>;
	canvas: DOMFactory<HTMLCanvasElement>;
	caption: DOMFactory<HTMLElement>;
	center: DOMFactory<HTMLElement>;
	cite: DOMFactory<HTMLElement>;
	code: DOMFactory<HTMLElement>;
	col: DOMFactory<HTMLTableColElement>;
	colgroup: DOMFactory<HTMLTableColElement>;
	data: DOMFactory<HTMLDataElement>;
	datalist: DOMFactory<HTMLDataListElement>;
	dd: DOMFactory<HTMLElement>;
	del: DOMFactory<HTMLModElement>;
	details: DOMFactory<HTMLDetailsElement>;
	dfn: DOMFactory<HTMLElement>;
	dialog: DOMFactory<HTMLDialogElement>;
	div: DOMFactory<HTMLDivElement>;
	dl: DOMFactory<HTMLDListElement>;
	dt: DOMFactory<HTMLElement>;
	em: DOMFactory<HTMLElement>;
	embed: DOMFactory<HTMLEmbedElement>;
	fieldset: DOMFactory<HTMLFieldSetElement>;
	figcaption: DOMFactory<HTMLElement>;
	figure: DOMFactory<HTMLElement>;
	footer: DOMFactory<HTMLElement>;
	form: DOMFactory<HTMLFormElement>;
	h1: DOMFactory<HTMLHeadingElement>;
	h2: DOMFactory<HTMLHeadingElement>;
	h3: DOMFactory<HTMLHeadingElement>;
	h4: DOMFactory<HTMLHeadingElement>;
	h5: DOMFactory<HTMLHeadingElement>;
	h6: DOMFactory<HTMLHeadingElement>;
	head: DOMFactory<HTMLHeadElement>;
	header: DOMFactory<HTMLElement>;
	hgroup: DOMFactory<HTMLElement>;
	hr: DOMFactory<HTMLHRElement>;
	html: DOMFactory<HTMLHtmlElement>;
	i: DOMFactory<HTMLElement>;
	iframe: DOMFactory<HTMLIFrameElement>;
	img: DOMFactory<HTMLImageElement>;
	input: DOMFactory<HTMLInputElement>;
	ins: DOMFactory<HTMLModElement>;
	kbd: DOMFactory<HTMLElement>;
	keygen: DOMFactory<HTMLElement>;
	label: DOMFactory<HTMLLabelElement>;
	legend: DOMFactory<HTMLLegendElement>;
	li: DOMFactory<HTMLLIElement>;
	link: DOMFactory<HTMLLinkElement>;
	main: DOMFactory<HTMLElement>;
	map: DOMFactory<HTMLMapElement>;
	mark: DOMFactory<HTMLElement>;
	menu: DOMFactory<HTMLElement>;
	menuitem: DOMFactory<HTMLElement>;
	meta: DOMFactory<HTMLMetaElement>;
	meter: DOMFactory<HTMLMeterElement>;
	nav: DOMFactory<HTMLElement>;
	noscript: DOMFactory<HTMLElement>;
	object: DOMFactory<HTMLObjectElement>;
	ol: DOMFactory<HTMLOListElement>;
	optgroup: DOMFactory<HTMLOptGroupElement>;
	option: DOMFactory<HTMLOptionElement>;
	output: DOMFactory<HTMLOutputElement>;
	p: DOMFactory<HTMLParagraphElement>;
	param: DOMFactory<HTMLParamElement>;
	picture: DOMFactory<HTMLElement>;
	pre: DOMFactory<HTMLPreElement>;
	progress: DOMFactory<HTMLProgressElement>;
	q: DOMFactory<HTMLQuoteElement>;
	rp: DOMFactory<HTMLElement>;
	rt: DOMFactory<HTMLElement>;
	ruby: DOMFactory<HTMLElement>;
	s: DOMFactory<HTMLElement>;
	samp: DOMFactory<HTMLElement>;
	search: DOMFactory<HTMLElement>;
	slot: DOMFactory<HTMLSlotElement>;
	script: DOMFactory<HTMLScriptElement>;
	section: DOMFactory<HTMLElement>;
	select: DOMFactory<HTMLSelectElement>;
	small: DOMFactory<HTMLElement>;
	source: DOMFactory<HTMLSourceElement>;
	span: DOMFactory<HTMLSpanElement>;
	strong: DOMFactory<HTMLElement>;
	style: DOMFactory<HTMLStyleElement>;
	sub: DOMFactory<HTMLElement>;
	summary: DOMFactory<HTMLElement>;
	sup: DOMFactory<HTMLElement>;
	table: DOMFactory<HTMLTableElement>;
	template: DOMFactory<HTMLTemplateElement>;
	tbody: DOMFactory<HTMLTableSectionElement>;
	td: DOMFactory<HTMLTableDataCellElement>;
	textarea: DOMFactory<HTMLTextAreaElement>;
	tfoot: DOMFactory<HTMLTableSectionElement>;
	th: DOMFactory<HTMLTableHeaderCellElement>;
	thead: DOMFactory<HTMLTableSectionElement>;
	time: DOMFactory<HTMLTimeElement>;
	title: DOMFactory<HTMLTitleElement>;
	tr: DOMFactory<HTMLTableRowElement>;
	track: DOMFactory<HTMLTrackElement>;
	u: DOMFactory<HTMLElement>;
	ul: DOMFactory<HTMLUListElement>;
	var: DOMFactory<HTMLElement>;
	video: DOMFactory<HTMLVideoElement>;
	wbr: DOMFactory<HTMLElement>;
	// webview: DOMFactory<HTMLWebViewElement>;
}

export function createElement<T extends HTMLElement>(
	tag: keyof HTMLTypes,
	props: JSX.Attributes<T>,
	...children: JSX.Renderable[]
): JSX.HTMLRenderable<T>;

export function createElement<P, N extends Node, R extends JSX.Renderable<N>>(tag: JSX.Component<P, N, R>, props: P): R;

export function createElement<P, N extends Node, R extends JSX.Renderable<N>, C extends Array<any>>(
	tag: JSX.ParentComponent<P, N, R, C>,
	props: P,
	...children: C
): R;

export function createElement<P = never, C extends Array<any> = never>(
	tag: string | (new (props: P) => JSX.Renderable) | (new (props: P, children: C) => JSX.Renderable),
	props: P,
	...children: C
) {
	children = children.flat() as C;
	if (typeof tag !== 'string') {
		return new tag(props, children);
	}

	const el = document.createElement(tag);
	Object.assign(el, props);

	return {
		el,
		render() {
			children.forEach((x) => render(x, el));
			return el;
		},
	};
}

export function render(element: Node | JSX.Renderable, container: ParentNode): void {
	while (typeof element === 'object' && element && 'render' in element) {
		element = element.render();
	}
	container.append(element);
}
