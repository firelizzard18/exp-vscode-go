#version 300 es

// Copyright (c) Microsoft Corporation. MIT license.
// Source: https://github.com/microsoft/vscode-js-profile-visualizer/blob/f2f6b5ba9356be1b590dd563e5947e246972d3ab/packages/vscode-js-profile-flame/src/client/common/webgl/box.vert

// Box data. x/y positions, x in 0-1 percentages of the total height and y in
// pixels, and then the graph ID followed by a categorization (model's Category)
in vec4 boxes;

uniform mat4 projection;

// current hovered graph ID, or -1
uniform int hovered;

// current focused graph ID, or -1
uniform int focused;

// color of focused elements
uniform vec4 focus_color;

// base primary color, as hsv
uniform vec4 primary_color;

out vec4 v_color;

// murmur3's 32-bit finalizer, which we use as a simple and fast hash function:
int hash(int h) {
	h ^= h >> 16;
	h *= 2246822507;
	h ^= h >> 13;
	h *= 3266489909;
	h ^= h >> 16;

	return h;
}

float vary_by(float value, float seed, float amount) {
	return value + (seed - 0.5f) * amount;
}

float wrap(float value) {
	if(value < 0.0f) {
		return value + 1.0f;
	}

	if(value > 1.0f) {
		return value - 1.0f;
	}

	return value;
}

// Conversion from lolengine wunder WTFPL (https://github.com/lolengine/lolengine/blob/master/COPYING)
// https://github.com/lolengine/lolengine/blob/c826bbd6f023e878057f22457ea3caf72de60bd4/doc/samples/front_camera_sprite.lolfx#L67-L72
vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0f, 2.0f / 3.0f, 1.0f / 3.0f, 3.0f);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0f - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0f, 1.0f), c.y);
}

void main() {
	gl_Position = projection * vec4(boxes[0], boxes[1], 0, 1);

	mediump int group = int(boxes[2]);
	mediump int color_hash = hash(group); // djb2's prime, just some bogus stuff
	mediump float h = wrap(vary_by(primary_color[0], float(color_hash & 255) / 255.0f, 0.1f));
	mediump float s = clamp(vary_by(primary_color[1], float((color_hash >> 8) & 255) / 255.0f, 0.1f), 0.0f, 1.0f);
	v_color = vec4(hsv2rgb(vec3(h, s, primary_color[2])), primary_color[3]);

	mediump int id = int(boxes[3]);
	if(focused == id) {
		v_color = focus_color;
	}
	if(hovered == id) {
		v_color[0] *= 0.8f;
	}
}
