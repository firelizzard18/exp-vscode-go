/* eslint-disable @typescript-eslint/no-unused-vars */
import './main.css';
import { createElement, render } from './jsx';
import { FlameGraph } from './FlameGraph';
import { State } from './State';

function App() {
	const { profile } = State;
	if (profile) {
		return (
			<div>
				<FlameGraph profile={profile} />
			</div>
		);
	}

	const div = (
		<div>
			<span className="loading">Loading profile data...</span>
		</div>
	) as JSX.HTMLRenderable<HTMLDivElement>;

	(async () => {
		const el = document.getElementById('profile-data') as HTMLScriptElement;
		const r = await fetch(el.src);
		const profile = await r.json();
		div.el.innerHTML = '';
		State.profile = profile;
		render(<FlameGraph profile={profile} />, div.el);
	})().catch((e) => {
		console.error(e);
		div.el.innerHTML = '';
		render(<span>Unable to locate profile data</span>, div.el);
	});

	return div;
}

render(<App />, document.body);
