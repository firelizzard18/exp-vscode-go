// Heavily based on https://github.com/microsoft/vscode-js-profile-visualizer/blob/3e421036c6028d64ac534edc5a83d4fc41457626/packages/vscode-js-profile-flame/src/client/common/webgl/boxes.ts
// Original work copyright (c) Microsoft Corporation.

export function compileProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

	const program = gl.createProgram();
	if (!program) {
		throw new Error('Failed creating program');
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
		return program;
	}

	const log = gl.getProgramInfoLog(program);
	gl.deleteProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	throw new Error(`Program creation failed (${log || 'unknown'})`);
}

function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string) {
	const shader = gl.createShader(type);
	if (!shader) {
		throw new Error(`Failed creating shader ${type}`);
	}

	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		return shader;
	}

	const log = gl.getShaderInfoLog(shader);
	gl.deleteShader(shader);
	throw new Error(`Shader creation failed (${log || 'unknown'})`);
}
