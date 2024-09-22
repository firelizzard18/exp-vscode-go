// Heavily based on https://github.com/microsoft/vscode-js-profile-visualizer/blob/3e421036c6028d64ac534edc5a83d4fc41457626/packages/vscode-js-profile-flame/src/client/common/webgl/boxes.ts
// Original work copyright (c) Microsoft Corporation.

/* eslint-disable @typescript-eslint/no-unused-vars */
import { compileProgram } from './gl';
import { createElement, render } from './jsx';
import fragmentShaderSource from './box.frag';
import vertexShaderSource from './box.vert';
import chroma from 'chroma-js';
import { mat4 } from 'gl-matrix';

export interface Box {
	// column: number;
	// row: number;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	// color: number;
	// level: number;
	// text: string;
	category: number;
	loc: IColumnRow;
}

export type IColumnRow = {
	graphId: number; // unique ID of the location in the graph
};

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

export const enum Constants {
	BoxHeight = 20,
	TextColor = '#fff',
	BoxColor = '#000',
	TimelineHeight = 22,
	TimelineLabelSpacing = 100,
	MinWindow = 0.005,
	ExtraYBuffer = 300,
	DefaultStackLimit = 7,
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

export class Boxes {
	readonly canvas = (() => {
		// Our WebGL code will fail if the canvas is not in the DOM
		const c = (<canvas className="boxes" />) as JSX.HTMLRenderable<HTMLCanvasElement>;
		render(c, document.body);
		c.el.width = c.el.clientWidth;
		c.el.height = c.el.clientHeight;
		return c;
	})();

	readonly gl = must(this.canvas.el.getContext('webgl2'), 'get WebGL context');
	readonly program = compileProgram(this.gl, vertexShaderSource, fragmentShaderSource);

	readonly location = {
		boxes: must(this.gl.getAttribLocation(this.program, 'boxes'), 'get boxes'),
		projection: must(this.gl.getUniformLocation(this.program, 'projection'), 'get projection'),
		hovered: this.gl.getUniformLocation(this.program, 'hovered'),
		focused: this.gl.getUniformLocation(this.program, 'focused'),
		color: {
			focus: must(this.gl.getUniformLocation(this.program, 'focus_color'), 'get focus color'),
			primary: must(this.gl.getUniformLocation(this.program, 'primary_color'), 'get primary color'),
		} as const,
	} as const;

	readonly buffer = {
		vertex: must(this.gl.createBuffer(), 'create vertex buffer'),
		index: must(this.gl.createBuffer(), 'create index buffer'),
	} as const;

	vertexCount = 0;

	constructor({ scale, focusColor, primaryColor }: { scale: number; focusColor: string; primaryColor: string }) {
		this.gl.clearColor(0, 0, 0, 0);
		this.gl.useProgram(this.program);

		// Show X: ±10, Y: ±10/aspect, Z: ±1
		const aspect = this.canvas.el.clientWidth / this.canvas.el.clientHeight;
		const projectionMatrix = mat4.create();
		mat4.ortho(projectionMatrix, -10.0, 10.0, -10.0 / aspect, 10.0 / aspect, -1, 1);
		this.gl.uniformMatrix4fv(this.location.projection, false, projectionMatrix);

		// Initialize
		this.setBoxes([{ x1: -1, y1: -1, x2: +1, y2: +1, category: 1, loc: { graphId: 0 } }]);
		this.setFocusColor(focusColor);
		this.setPrimaryColor(primaryColor);
		this.setHovered();
		this.setFocused();
		this.redraw();
	}

	setHovered(hovered: number = -1) {
		this.gl.uniform1i(this.location.hovered, hovered);
	}

	setFocused(focused: number = -1) {
		this.gl.uniform1i(this.location.focused, focused);
	}

	setFocusColor(color: string) {
		const rgba = this.#resolveColor(color).rgba();
		rgba[3] = 255;
		this.gl.uniform4fv(this.location.color.focus, new Float32Array(rgba.map((r) => r / 255)));
	}

	setPrimaryColor(color: string) {
		const parsed = this.#resolveColor(color);
		const hsv = parsed.luminance(Math.min(parsed.luminance(), 0.25)).hsv();
		this.gl.uniform4f(this.location.color.primary, hsv[0] / 360, hsv[1], hsv[2], parsed.alpha());
	}

	#resolveColor(color: string) {
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

	setBoxes(boxes: readonly Box[]) {
		const { gl } = this;

		const vertices = new Float32Array(
			boxes.flatMap((box) => [
				// top left
				box.x1,
				box.y1,
				box.loc.graphId,
				box.category,

				// top right
				box.x2,
				box.y1,
				box.loc.graphId,
				box.category,

				// bottom left
				box.x1,
				box.y2,
				box.loc.graphId,
				box.category,

				// bottom right
				box.x2,
				box.y2,
				box.loc.graphId,
				box.category,
			]),
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

	redraw() {
		const { gl } = this;
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer.index);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer.vertex);
		gl.enableVertexAttribArray(this.location.boxes);
		gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_SHORT, 0);
	}

	render() {
		return this.canvas;
	}
}
