/* eslint-disable @typescript-eslint/no-namespace */
import { Message } from './messages';

const vscode = acquireVsCodeApi<StateData>();

export function sendMessage(message: Message) {
	vscode.postMessage(message);
}

export function addMessageListener(fn: (_: Message) => void) {
	const fn2 = (event: MessageEvent<Message>) => {
		if (!event.data || typeof event.data !== 'object') return;
		if (!('event' in event.data || 'command' in event.data)) return;
		fn(event.data);
	};

	window.addEventListener('message', fn2);
	return () => window.removeEventListener('message', fn2);
}

interface StateData {
	profile?: Profile;
	flameGraph?: FlameGraphSettings;
}

export interface FlameGraphSettings {
	sample: number;
	focused: number | null;
	ignored: number[];
}

export const State = new (class {
	get profile(): Profile | undefined {
		return this.#get('profile');
	}
	set profile(profile: Profile) {
		this.#set('profile', profile);
	}

	get flameGraph(): FlameGraphSettings {
		return this.#get('flameGraph') || { sample: -1, ignored: [], focused: null };
	}
	set flameGraph(flameGraph: FlameGraphSettings) {
		this.#set('flameGraph', flameGraph);
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
