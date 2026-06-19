import { Disposable } from 'vscode';

export class Disposer implements Disposable {
	readonly #subscriptions: Disposable[] = [];

	protected set disposeOf(sub: Disposable | Iterable<Disposable>) {
		if (Symbol.iterator in sub) {
			this.#subscriptions.push(...sub);
		} else {
			this.#subscriptions.push(sub);
		}
	}

	dispose() {
		const subs = this.#subscriptions.splice(0, this.#subscriptions.length);
		subs.forEach((sub) => sub.dispose());
	}
}
