// Based on https://github.com/microsoft/vscode-js-profile-visualizer/blob/3e421036c6028d64ac534edc5a83d4fc41457626/packages/vscode-js-profile-flame/src/client/common/webgl/boxes.ts
// Original work copyright (c) Microsoft Corporation.

/* eslint-disable @typescript-eslint/no-unused-vars */
import { useProgram } from './gl';
import { createElement } from './jsx';
import fragmentShaderSource from './box.frag';
import vertexShaderSource from './box.vert';
import chroma, { Color } from 'chroma-js';
import { mat4 } from 'gl-matrix';

/**
 * The height of a box, in pixels. This is with reference to the rendering
 * context, i.e. it does not need to account for the device pixel ratio.
 */
const boxHeight = 18;

export interface Box {
	/**
	 * The label overlaid on the box.
	 */
	label: string;

	/**
	 * The ID of the box, used for hovering.
	 */
	id: number;

	/**
	 * The vertical level/coordinate of the box.
	 */
	level: number;

	/**
	 * The group the box belongs to, for coloring.
	 */
	group: number;

	/**
	 * The starting X position, as a percentage.
	 */
	x1: number;

	/**
	 * The ending X position, as a percentage.
	 */
	x2: number;

	/**
	 * The horizontal alignment of the label.
	 */
	alignLabel?: 'left' | 'center' | 'right';
}

const must = function <T>(value: T | null | undefined | (() => T | null | undefined), op: string): T {
	if (value instanceof Function) {
		value = value();
	}
	if (value === null || value === undefined || value === -1) {
		throw new Error(`Unable to ${op}`);
	}
	return value;
};

/**
 * Renders a collection of {@link Box}es.
 */
export class Boxes<B extends Box = Box> {
	#renderer?: Renderer<B>;
	#el?: JSX.HTMLRenderable<HTMLDivElement>;

	constructor(
		private readonly props: {
			boxColor: string;
			textColor: string;
			textColor2: string;
			boxes: B[];
			onHovered?: (box?: B) => void;
			onFocused?: (box?: B) => void;
		},
	) {}

	render() {
		// Initialize the DOM elements
		const { el: glCanvas } = (<canvas />) as JSX.HTMLRenderable<HTMLCanvasElement>;
		const { el: textCanvas } = (<canvas />) as JSX.HTMLRenderable<HTMLCanvasElement>;
		this.#el = (
			<div className="boxes" data-vscode-context={{ preventDefaultContextMenuItems: true }}>
				<span className="spacer" />
				{glCanvas}
				{textCanvas}
			</div>
		) as JSX.HTMLRenderable<HTMLDivElement>;

		// A callback to (re)initialize the renderer
		const setRenderer = () => {
			const { width, height } = this.#size();

			if (!this.#renderer) {
				this.#renderer = new Renderer({ ...this.props, glCanvas, textCanvas, width, height });
			} else {
				this.#renderer.draw(this.props.boxes, { width, height });
			}
		};

		// Initialize the renderer in the next animation frame
		this.#update(() => setRenderer());

		// When there is a resize event, reinitialize the renderer (in the next
		// animation frame)
		addEventListener('resize', () => this.#update(() => setRenderer()));

		// Track the last hover/focus event target to avoid issuing duplicate
		// events
		const lastBox = {
			onHovered: null as B | null | undefined,
			onFocused: null as B | null | undefined,
		};

		// Resolve a mouse event to a Box
		const resolve = (event: MouseEvent, last: 'onHovered' | 'onFocused') => {
			// Sanity check
			if (!this.#renderer) return;

			// Decode the position
			const { x, y } = this.#targetXY(event);
			if (!x || !y) return;

			// Find the box, avoid duplicate events
			const box = this.#renderer.boxAt(x, y);
			if (box === lastBox[last]) return;
			lastBox[last] = box;
			return { box };
		};

		// Mouse move -> hovered
		this.#el.el.addEventListener('mousemove', (event) => {
			const r = resolve(event, 'onHovered');
			if (!r) return;
			this.props.onHovered?.(r.box);

			// Highlight the hovered box
			this.#renderer && (this.#renderer.hovered = r.box);
			this.#update(() => this.#renderer?.draw());
		});

		// Mouse click -> focused
		this.#el.el.addEventListener('click', (event) => {
			const r = resolve(event, 'onFocused');
			r && this.props.onFocused?.(r.box);
		});

		return this.#el;
	}

	/**
	 * @returns The logical size of the rendering contexts
	 */
	#size() {
		// Sanity check
		if (!this.#el) return { width: 0, height: 0 };

		// Remove <canvas> children
		const children = Array.from(this.#el.el.children);
		children.forEach((x) => x.remove());

		// Resize the spacer
		const minLevel = Math.min(...this.props.boxes.map((b) => b.level));
		const maxLevel = Math.max(...this.props.boxes.map((b) => b.level));
		children.forEach((x) => {
			if (x instanceof HTMLElement && x.classList.contains('spacer')) {
				x.style.height = `${(maxLevel - minLevel + 1) * boxHeight}px`;
				this.#el?.el.appendChild(x);
			}
		});

		// The render size is the DOM pixel width/height, multiplied by the
		// device pixel ratio to account for high DPI displays
		const width = Math.floor(this.#el.el.clientWidth * devicePixelRatio);
		const height = Math.floor(this.#el.el.clientHeight * devicePixelRatio);

		// Restore <canvas> children
		children.forEach((x) => this.#el!.el.appendChild(x));
		return { width, height };
	}

	/**
	 * Decodes the (X, Y) position of a mouse event.
	 */
	#targetXY(event: MouseEvent) {
		// Sanity check
		if (!(event.target instanceof Element)) return {};

		// Adjust the event coordinates to be relative to the top left corner of
		// the element
		const { top, left } = event.target.getBoundingClientRect();
		const { clientX, clientY } = event;
		return { x: clientX - left, y: clientY - top };
	}

	/**
	 * Update the set of {@link Box}es and redraw.
	 */
	set boxes(boxes: B[]) {
		this.props.boxes = boxes;
		this.#update(() => this.#renderer?.draw(boxes, this.#size()));
	}

	#lastUpdate?: number;
	#renderQueue: (() => void)[] = [];

	/**
	 * Queue a function for execution on the next animation frame.
	 */
	#update(fn: () => void) {
		// Cancel the previous request
		if (this.#lastUpdate) {
			cancelAnimationFrame(this.#lastUpdate);
		}

		// Push the function to the queue
		this.#renderQueue.push(fn);

		// Request an animation frame
		this.#lastUpdate = requestAnimationFrame(() => {
			// Execute and reset the queue
			const fns = this.#renderQueue.slice();
			this.#renderQueue.splice(0, this.#renderQueue.length);
			fns.forEach((fn) => fn());
		});
	}
}

class Renderer<B extends Box> {
	/**
	 * The 2D rendering context.
	 */
	readonly ctx: CanvasRenderingContext2D;

	/**
	 * The 3D (WebGL) rendering context.
	 */
	readonly gl: WebGL2RenderingContext;

	/**
	 * The box shader program.
	 */
	readonly program: WebGLProgram;

	readonly buffer: {
		/**
		 * The vertex buffer.
		 */
		readonly vertex: WebGLBuffer;

		/**
		 * The index buffer. Indexes into the vertex buffer to describe
		 * triangle.
		 */
		readonly index: WebGLBuffer;
	};

	readonly location: {
		/**
		 * The boxes attribute;
		 */
		readonly boxes: number;

		/**
		 * The projection matrix.
		 */
		readonly projection: WebGLUniformLocation;

		/**
		 * The ID of the hovered box.
		 */
		readonly hovered: WebGLUniformLocation;

		/**
		 * The base color for box.
		 */
		readonly boxColor: WebGLUniformLocation;
	};

	/**
	 * The color of box labels.
	 */
	readonly textColor: Color;

	/**
	 * The color for metadata (used to display the focused box's metrics).
	 */
	readonly textColor2: Color;

	constructor({
		boxColor,
		textColor,
		textColor2,
		boxes,
		glCanvas,
		textCanvas,
		width,
		height,
	}: {
		boxColor: string;
		textColor: string;
		textColor2: string;
		boxes: B[];
		glCanvas: HTMLCanvasElement;
		textCanvas: HTMLCanvasElement;
		width: number;
		height: number;
	}) {
		// Set the canvas dimensions
		textCanvas.width = width;
		textCanvas.height = height;
		glCanvas.width = width;
		glCanvas.height = height;

		// Create the 2D rendering context
		this.ctx = must(textCanvas.getContext('2d'), 'get 2D context');

		// Create the WebGL context and compile the shader program
		this.gl = must(glCanvas.getContext('webgl2'), 'get WebGL context');
		this.program = useProgram(this.gl, vertexShaderSource, fragmentShaderSource);

		// Set up a vertex buffer, and an element index (triangle) buffer
		this.buffer = {
			vertex: must(this.gl.createBuffer(), 'create vertex buffer'),
			index: must(this.gl.createBuffer(), 'create index buffer'),
		};

		// Get locations for the shader's attributes and uniforms
		this.location = {
			boxes: must(this.gl.getAttribLocation(this.program, 'boxes'), 'get boxes location'),
			projection: must(this.gl.getUniformLocation(this.program, 'projection'), 'get projection location'),
			hovered: must(this.gl.getUniformLocation(this.program, 'hovered'), 'get hovered location'),
			boxColor: must(this.gl.getUniformLocation(this.program, 'box_color'), 'get box color location'),
		};

		// Convert colors that may be CSS variable references into chroma
		// colors
		this.textColor = resolveColor(textColor);
		this.textColor2 = resolveColor(textColor2);
		this.boxColor = boxColor;

		// Initialize and draw the first frame
		this.draw(boxes, { width, height });
	}

	set hovered(hovered: B | null | undefined) {
		// Set the hovered shader attribute
		this.gl.uniform1i(this.location.hovered, hovered ? hovered.id : -1);
	}

	set boxColor(color: string) {
		// Convert the color to HSV and set the shader attribute
		const parsed = resolveColor(color);
		const hsv = parsed.luminance(Math.min(parsed.luminance(), 0.25)).hsv();
		this.gl.uniform4f(this.location.boxColor, hsv[0] / 360, hsv[1], hsv[2], parsed.alpha());
	}

	/**
	 * Returns the {@link B} at the given coordinates.
	 */
	boxAt(cx: number, cy: number) {
		// Convert X to a percentage and Y to a level. -1 makes the transition
		// between boxes smoother for reasons I don't understand.
		const x = (cx * devicePixelRatio - 1) / this.gl.canvas.width;
		const y = Math.floor((cy - 1) / boxHeight);
		return this.#boxes.find((b) => b.x1 <= x && x <= b.x2 && b.level === y + this.#minLevel);
	}

	/**
	 * Calculates the (X, Y) extent of a {@link B}.
	 */
	#boxPos(box: B) {
		const width = this.gl.canvas.width;
		const level = box.level - this.#minLevel;
		const x1 = Math.ceil(box.x1 * width) + 1;
		const x2 = Math.ceil(box.x2 * width) - 1;
		const y1 = Math.ceil(level * boxHeight * devicePixelRatio) + 1;
		const y2 = Math.ceil((level + 1) * boxHeight * devicePixelRatio) - 1;
		return { x1, x2, y1, y2 };
	}

	#minLevel = 0;
	#boxes: B[] = [];

	/**
	 * Draws boxes.
	 * @param boxes - Render a new set of boxes.
	 * @param size - Update the canvas size.
	 */
	draw(boxes?: B[], size?: { width: number; height: number }) {
		// Do we need to (re)size the canvases?
		if (size) {
			this.#setSize(size);
		}

		// Do we need to recalculate labels and box geometries?
		if (size || (boxes && boxes !== this.#boxes)) {
			if (boxes) this.#boxes = boxes;

			// The level of a box is allowed to be negative, but that would
			// place it above the top of the context. Adjusting levels to be
			// relative to the minimum level fixes that.
			this.#minLevel = Math.min(...this.#boxes.map((b) => b.level));

			// Reset hovered
			this.hovered = null;

			this.#drawBoxes(this.#boxes);
			this.#drawLabels(this.#boxes);
		}

		const { gl } = this;

		// Clear the color buffer (but not the depth buffer because we're not doing 3D)
		this.gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		// Bind the vertex and index/element buffers
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer.vertex);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer.index);

		// Bind vertex data to the corresponding shader attribute
		gl.enableVertexAttribArray(this.location.boxes);

		// Draw the boxes. Each box consists of two triangles, each of which
		// consist of three vertices, so the vertex count is 6 times the number
		// of boxes. Full OpenGL supports larger polygons, but GLES/WebGL only
		// supports triangles.
		gl.drawElements(gl.TRIANGLES, this.#boxes.length * 2 * 3, gl.UNSIGNED_SHORT, 0);
	}

	/**
	 * Resize the canvases.
	 */
	#setSize(size: { width: number; height: number }) {
		// Update the 2D context's width and height
		const { gl, ctx } = this;
		ctx.canvas.width = size.width;
		ctx.canvas.height = size.height;

		// Changing the width and height appears to reset these properties, so
		// we need to re-set them
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
		ctx.font = '12px monospace';
		ctx.textBaseline = 'middle';

		// Set the viewport and width and height
		gl.viewport(0, 0, size.width, size.height);
		gl.canvas.width = size.width;
		gl.canvas.height = size.height;

		// Use an orthographic projection matrix set to the width and height of
		// the viewport. The Z values are arbitrary but must contain Z=0. We
		// might be able to eliminate this by converting the box vertex
		// coordinates to [0, 1] instead of [0, width/height], but why fix
		// something that isn't broken?
		const projectionMatrix = mat4.create();
		mat4.ortho(projectionMatrix, 0, size.width, size.height, 0, -1, 1);
		gl.uniformMatrix4fv(this.location.projection, false, projectionMatrix);

		// Use CSS to force the actual width/height to match the logical
		// width/height (accounting for device pixel ratio)
		ctx.canvas.style.width = `${size.width / devicePixelRatio}px`;
		ctx.canvas.style.height = `${size.height / devicePixelRatio}px`;
		(gl.canvas as HTMLCanvasElement).style.width = `${size.width / devicePixelRatio}px`;
		(gl.canvas as HTMLCanvasElement).style.height = `${size.height / devicePixelRatio}px`;
	}

	#drawBoxes(boxes: B[]) {
		// This doesn't actually _draw_ the boxes, it recalculates their sizes,
		// but it reads better this way

		// (x, y, id, group) for each corner of each box
		const vertices = new Float32Array(
			boxes.flatMap((box) => {
				const { x1, x2, y1, y2 } = this.#boxPos(box);
				return [
					// top left
					x1,
					y1,
					box.group,
					box.id,

					// top right
					x2,
					y1,
					box.group,
					box.id,

					// bottom left
					x1,
					y2,
					box.group,
					box.id,

					// bottom right
					x2,
					y2,
					box.group,
					box.id,
				];
			}),
		);

		// Vertex index triples for the two triangles of each box
		const indices = new Uint16Array(
			boxes.flatMap((_, i) => [
				// triangle 1:
				i * 4 + 0, // top left
				i * 4 + 1, // top right
				i * 4 + 2, // bottom left

				// triangle 2:
				i * 4 + 1, // top right
				i * 4 + 3, // bottom right
				i * 4 + 2, // bottom left
			]),
		);

		// Load the buffers into the GPU
		const { gl } = this;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer.vertex);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer.index);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

		// Magic?
		gl.vertexAttribPointer(this.location.boxes, 4, gl.FLOAT, false, 0, 0);
	}

	#drawLabels(boxes: B[]) {
		const { ctx } = this;

		// Erase any old labels
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

		boxes.forEach((box) => {
			// Calculate the box position and width
			const { x1, x2, y1, y2 } = this.#boxPos(box);
			const y = (y1 + y2) / 2 / devicePixelRatio;
			const w = (x2 - x1) / devicePixelRatio - 2;

			// If the label would be wider than the box, elide the middle
			let label = box.label;
			const m = ctx.measureText(label + '…');
			if (m.width > w) {
				const n = Math.floor((label.length * w) / m.width / 2);
				label = `${label.slice(0, n)}…${label.slice(label.length - n)}`;
			}

			// Render the label. I think the logic here is a bit skewed. There
			// should probably be one conditional (box.id) for the fill color
			// and a separate conditional (textAlign) for the fillText
			// arguments.
			ctx.textAlign = box.alignLabel ?? 'left';
			if (box.id < 0) {
				ctx.fillStyle = this.textColor2.css();
				ctx.fillText(label, (x1 + x2) / 2 / devicePixelRatio, y, w);
			} else {
				ctx.fillStyle = this.textColor.css();
				ctx.fillText(label, x1 / devicePixelRatio + 2, y, w);
			}
		});
	}
}

/**
 * Resolves a color which may be a variable or other CSS value into a
 * {@link chroma.Color}.
 */
function resolveColor(color: string) {
	// Resolve CSS variables
	color = color.trim();
	if (color.startsWith('--')) {
		const x = getComputedStyle(document.documentElement).getPropertyValue(color);
		if (x) color = x;
	}

	// Convert to a chroma color
	if (!chroma.valid(color)) {
		throw new Error(`Invalid color: ${color}`);
	}

	return chroma(color);
}
