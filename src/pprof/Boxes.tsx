// Based on https://github.com/microsoft/vscode-js-profile-visualizer/blob/3e421036c6028d64ac534edc5a83d4fc41457626/packages/vscode-js-profile-flame/src/client/common/webgl/boxes.ts
// Original work copyright (c) Microsoft Corporation.

/* eslint-disable @typescript-eslint/no-unused-vars */
import { compileProgram } from './gl';
import { createElement, render } from './jsx';
import fragmentShaderSource from './box.frag';
import vertexShaderSource from './box.vert';
import chroma from 'chroma-js';
import { mat4 } from 'gl-matrix';

export interface Box {
	label: string;
	id: number;
	level: number;
	group: number;
	x1: number;
	x2: number;
}

export interface IBounds {
	minX: number;
	maxX: number;
	y: number;
	level: number;
}

export interface ICanvasSize {
	width: number;
	height: number;
}

const boxHeight = 18;

const pixelRatio = (function () {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ctx = document.createElement('canvas').getContext('2d') as any;
	const dpr = window.devicePixelRatio || 1;
	const bsr =
		ctx.webkitBackingStorePixelRatio ||
		ctx.mozBackingStorePixelRatio ||
		ctx.msBackingStorePixelRatio ||
		ctx.oBackingStorePixelRatio ||
		ctx.backingStorePixelRatio ||
		1;

	return dpr / bsr;
})();

const must = function <T>(value: T | null | undefined | (() => T | null | undefined), op: string): T {
	if (value instanceof Function) {
		value = value();
	}
	if (value === null || value === undefined || value === -1) {
		throw new Error(`Unable to ${op}`);
	}
	return value;
};

export class Boxes {
	#renderer?: Renderer;

	constructor(
		private readonly props: { focusColor: string; primaryColor: string; textColor: string; boxes: Box[] },
	) {}

	render() {
		const glCanvas = (<canvas />) as JSX.HTMLRenderable<HTMLCanvasElement>;
		const textCanvas = (<canvas />) as JSX.HTMLRenderable<HTMLCanvasElement>;

		setTimeout(() => {
			this.#renderer = new Renderer({ ...this.props, glCanvas: glCanvas.el, textCanvas: textCanvas.el });
		}, 0);

		const el = (
			<div className="boxes">
				{glCanvas}
				{textCanvas}
			</div>
		) as JSX.HTMLRenderable<HTMLDivElement>;
		el.el.addEventListener('mousemove', (event) => this.#renderer?.didMoveMouse(event));
		return el;
	}

	setBoxes(boxes: Box[]) {
		this.#renderer!.setBoxes(boxes);
	}
}

class Renderer {
	readonly ctx: CanvasRenderingContext2D;
	readonly gl: WebGL2RenderingContext;
	readonly program: WebGLProgram;
	readonly buffer: {
		readonly vertex: WebGLBuffer;
		readonly index: WebGLBuffer;
	};
	readonly location: {
		readonly boxes: number;
		readonly projection: WebGLUniformLocation;
		readonly hovered: WebGLUniformLocation;
		readonly focused: WebGLUniformLocation;
		readonly focusColor: WebGLUniformLocation;
		readonly primaryColor: WebGLUniformLocation;
	};

	constructor({
		focusColor,
		primaryColor,
		textColor,
		boxes,
		glCanvas,
		textCanvas,
	}: {
		focusColor: string;
		primaryColor: string;
		textColor: string;
		boxes: Box[];
		glCanvas: HTMLCanvasElement;
		textCanvas: HTMLCanvasElement;
	}) {
		textCanvas.width = textCanvas.clientWidth * pixelRatio;
		textCanvas.height = textCanvas.clientHeight * pixelRatio;
		this.ctx = must(textCanvas.getContext('2d'), 'get 2D context');
		this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		this.ctx.fillStyle = resolveColor(textColor).css();
		this.ctx.font = '12px monospace';
		this.ctx.textBaseline = 'middle';

		glCanvas.width = glCanvas.clientWidth * pixelRatio;
		glCanvas.height = glCanvas.clientHeight * pixelRatio;
		this.gl = must(glCanvas.getContext('webgl2'), 'get WebGL context');
		this.program = compileProgram(this.gl, vertexShaderSource, fragmentShaderSource);

		this.buffer = {
			vertex: must(this.gl.createBuffer(), 'create vertex buffer'),
			index: must(this.gl.createBuffer(), 'create index buffer'),
		};

		this.location = {
			boxes: must(this.gl.getAttribLocation(this.program, 'boxes'), 'get boxes'),
			projection: must(this.gl.getUniformLocation(this.program, 'projection'), 'get projection'),
			hovered: must(this.gl.getUniformLocation(this.program, 'hovered'), 'get hovered'),
			focused: must(this.gl.getUniformLocation(this.program, 'focused'), 'get focused'),
			focusColor: must(this.gl.getUniformLocation(this.program, 'focus_color'), 'get focus color'),
			primaryColor: must(this.gl.getUniformLocation(this.program, 'primary_color'), 'get primary color'),
		};

		this.gl.clearColor(0, 0, 0, 0);
		this.gl.useProgram(this.program);

		const projectionMatrix = mat4.create();
		mat4.ortho(projectionMatrix, 0, this.gl.canvas.width, this.gl.canvas.height, 0, -1, 1);
		this.gl.uniformMatrix4fv(this.location.projection, false, projectionMatrix);

		// Initialize
		this.setBoxes(boxes);
		this.setFocusColor(focusColor);
		this.setPrimaryColor(primaryColor);
		this.redraw();
	}

	vertexCount = 0;
	boxes: Box[] = [];

	didMoveMouse(event: MouseEvent) {
		// -1 makes the transition between boxes smoother
		const x = (event.clientX * pixelRatio - 1) / this.gl.canvas.width;
		const y = Math.floor((event.clientY - 1) / boxHeight);
		const box = this.boxes.find((b) => b.x1 <= x && x <= b.x2 && b.level === y);
		if (box) {
			this.setHovered(box);
		} else {
			this.setHovered();
		}
		this.redraw();
	}

	setHovered(hovered?: Box) {
		this.gl.uniform1i(this.location.hovered, hovered ? hovered.id : -1);
	}

	setFocused(focused?: Box) {
		this.gl.uniform1i(this.location.focused, focused ? focused.id : -1);
	}

	setFocusColor(color: string) {
		const rgba = resolveColor(color).rgba();
		rgba[3] = 255;
		this.gl.uniform4fv(this.location.focusColor, new Float32Array(rgba.map((r) => r / 255)));
	}

	setPrimaryColor(color: string) {
		const parsed = resolveColor(color);
		const hsv = parsed.luminance(Math.min(parsed.luminance(), 0.25)).hsv();
		this.gl.uniform4f(this.location.primaryColor, hsv[0] / 360, hsv[1], hsv[2], parsed.alpha());
	}

	setBoxes(boxes: Box[]) {
		this.boxes = boxes;
		this.setHovered();
		this.setFocused();

		const { gl } = this;

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
		this.vertexCount = indices.length;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer.vertex);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer.index);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
		gl.vertexAttribPointer(this.location.boxes, 4, gl.FLOAT, false, 0, 0);
	}

	#boxPos(box: Box) {
		const width = this.gl.canvas.width;
		const x1 = Math.ceil(box.x1 * width) + 1;
		const x2 = Math.ceil(box.x2 * width) - 1;
		const y1 = Math.ceil(box.level * boxHeight * pixelRatio + 1);
		const y2 = Math.ceil((box.level + 1) * boxHeight * pixelRatio - 1);
		return { x1, x2, y1, y2 };
	}

	redraw() {
		const { gl, ctx } = this;
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer.index);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer.vertex);
		gl.enableVertexAttribArray(this.location.boxes);
		gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_SHORT, 0);

		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		this.boxes.forEach((box) => {
			let label = box.label;
			const { x1, x2, y1, y2 } = this.#boxPos(box);
			const w = (x2 - x1) / pixelRatio - 2;
			const m = ctx.measureText(label + '…');
			if (m.width > w) {
				const n = Math.floor((label.length * w) / m.width / 2);
				label = `${label.slice(0, n)}…${label.slice(label.length - n)}`;
			}
			ctx.fillText(label, x1 / pixelRatio + 2, (y1 + y2) / 2 / pixelRatio, w);
		});
	}
}

function resolveColor(color: string) {
	color = color.trim();
	if (color.startsWith('--')) {
		const x = getComputedStyle(document.documentElement).getPropertyValue(color);
		if (x) color = x;
	}

	if (!chroma.valid(color)) {
		throw new Error(`Invalid color: ${color}`);
	}

	return chroma(color);
}
