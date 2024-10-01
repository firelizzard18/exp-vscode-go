/* eslint-disable @typescript-eslint/no-unused-vars */
import './main.css';
import { createElement, render } from './jsx';
import { FlameGraph } from './FlameGraph';
import { State } from './State';

function App() {
	// Avoid loading the profile if we've already done so and stored it in the
	// webview storage
	const { profile } = State;
	if (profile) {
		return (
			<div>
				<FlameGraph profile={profile} />
			</div>
		);
	}

	// Give the user something to look at
	const div = (
		<div>
			<span className="loading">Loading profile data...</span>
		</div>
	) as JSX.HTMLRenderable<HTMLDivElement>;

	// Load the profile asynchronously
	(async () => {
		// Retrieve the URL from <script id="profile-data"> and load it
		const el = document.getElementById('profile-data') as HTMLScriptElement;
		const r = await fetch(el.src);
		const profile = await r.json();

		// Store the profile, remove the loading message, and render
		State.profile = profile;
		div.el.innerHTML = '';
		render(<FlameGraph profile={profile} />, div.el);
	})().catch((e) => {
		// Tell the user if something went wrong
		console.error(e);
		div.el.innerHTML = '';
		render(<span>Unable to load profile data</span>, div.el);
	});

	return div;
}

// Render the viewer
render(<App />, document.body);
