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
export class EventEmitter<F extends (e: any) => void | Promise<void>> {
	readonly #listeners = new Set<F>();

	readonly event = (listener: F, thisArgs: any = {}, disposables?: Disposable[]): Disposable => {
		const l = (...args: Parameters<F>) => listener.call(thisArgs, ...args);
		const d = { dispose: () => this.#listeners.delete(<F>l) };
		this.#listeners.add(<F>l);
		disposables?.push(d);
		return d;
	};

	readonly fire = <F>(async (e: Parameters<F>[0]): Promise<void> => {
		// Return a promise to allow tests to await the result
		await Promise.all([...this.#listeners].map((l) => l(e)));
	});
}
