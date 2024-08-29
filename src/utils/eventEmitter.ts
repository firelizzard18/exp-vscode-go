/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Disposable {
	dispose(): any;
}

/**
 * EventEmitter is a clone of VSCode's event emitter, with one key change: the
 * promise returned by fire does not resolve until all listeners have finished
 * executing.
 */
export class EventEmitter<T> {
	readonly #listeners = new Set<(_: T) => any>();

	readonly event = (listener: (e: T) => any, thisArgs: any = {}, disposables?: Disposable[]): Disposable => {
		const l = (e: T) => listener.call(thisArgs, e);
		const d = { dispose: () => this.#listeners.delete(l) };
		this.#listeners.add(l);
		disposables?.push(d);
		return d;
	};

	fire = async (e: T): Promise<void> => {
		// Return a promise to allow tests to await the result
		await Promise.all([...this.#listeners].map((l) => l(e)));
	};
}
