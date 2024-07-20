/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

export class LineBuffer {
	private buf = '';
	private lineListeners: { (line: string): void }[] = [];
	private lastListeners: { (last: string | null): void }[] = [];

	public append(chunk: string) {
		this.buf += chunk;
		for (;;) {
			const idx = this.buf.indexOf('\n');
			if (idx === -1) {
				break;
			}

			this.fireLine(this.buf.substring(0, idx));
			this.buf = this.buf.substring(idx + 1);
		}
	}

	public done() {
		this.fireDone(this.buf !== '' ? this.buf : null);
	}

	public onLine(listener: (line: string) => void) {
		this.lineListeners.push(listener);
	}

	public onDone(listener: (last: string | null) => void) {
		this.lastListeners.push(listener);
	}

	private fireLine(line: string) {
		this.lineListeners.forEach((listener) => listener(line));
	}

	private fireDone(last: string | null) {
		this.lastListeners.forEach((listener) => listener(last));
	}
}
