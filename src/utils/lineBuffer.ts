/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

export class LineBuffer {
	#buf = '';
	readonly #lineListeners: { (line: string): void }[] = [];
	readonly #lastListeners: { (last: string | null): void }[] = [];
	readonly #onError;

	constructor(onError?: (err: unknown) => void) {
		this.#onError = onError;
	}

	append(chunk: string) {
		this.#buf += chunk;
		this.#sendLines();
	}

	done() {
		// Send lines in case they didn't get sent somehow. This shouldn't
		// happen, but it did happen prior to adding try-catch around the
		// listeners.
		this.#sendLines();
		this.#fireDone(this.#buf !== '' ? this.#buf : null);
	}

	onLine(listener: (line: string) => void) {
		this.#lineListeners.push(listener);
	}

	onDone(listener: (last: string | null) => void) {
		this.#lastListeners.push(listener);
	}

	#sendLines() {
		for (;;) {
			const idx = this.#buf.indexOf('\n');
			if (idx === -1) {
				break;
			}

			this.#fireLine(this.#buf.substring(0, idx));
			this.#buf = this.#buf.substring(idx + 1);
		}
	}

	#fireLine(line: string) {
		for (const listener of this.#lineListeners) {
			this.#call(listener, line);
		}
	}

	#fireDone(last: string | null) {
		for (const listener of this.#lastListeners) {
			this.#call(listener, last);
		}
	}

	#call<I>(listener: (_: I) => void, input: I) {
		if (!this.#onError) {
			listener(input);
			return;
		}
		try {
			listener(input);
		} catch (error) {
			this.#onError(error);
		}
	}
}
