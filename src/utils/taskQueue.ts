export class TaskQueue {
	#last = Promise.resolve();

	public do<R>(fn: () => Promise<R>) {
		const p = this.#last.then(fn);
		this.#last = p as Promise<void>;
		return p;
	}
}
