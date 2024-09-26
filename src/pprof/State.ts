/* eslint-disable @typescript-eslint/no-namespace */
import { Message } from './messages';

const vscode = acquireVsCodeApi<StateData>();

export function postMessage(message: Message) {
	vscode.postMessage(message);
}

interface StateData {
	profile?: Profile;
	sample?: number;
	focused?: number;
}

export const State = new (class {
	get profile(): Profile | undefined {
		return this.#get('profile');
	}
	set profile(profile: Profile) {
		this.#set('profile', profile);
	}

	get sample(): number | undefined {
		return this.#get('sample');
	}
	set sample(sample: number) {
		this.#set('sample', sample);
	}

	get focused(): number | undefined {
		return this.#get('focused');
	}
	set focused(focused: number | undefined) {
		this.#set('focused', focused);
	}

	#get<K extends keyof StateData>(key: K): StateData[K] | undefined;
	#get<K extends keyof StateData>(key: K, def: NonNullable<StateData[K]>): NonNullable<StateData[K]>;
	#get<K extends keyof StateData>(key: K, def?: StateData[K]): StateData[K] {
		const state = vscode.getState();
		return state?.[key] ?? def;
	}

	#set<K extends keyof StateData>(key: K, value: StateData[K]) {
		const state = vscode.getState() || {};
		state[key] = value;
		vscode.setState(state);
	}
})();
