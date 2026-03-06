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
		const profile = canonicalize(await r.json());

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

/**
 * Canonicalizes generic functions, rewriting `foo[int]` and `foo[string]` into
 * a single Func.
 */
function canonicalize(profile: Profile): Profile {
    if (!profile.Function || !profile.Location) return profile;

    // Group funcs by base name (stripping generic params)
    const canonical = new Map<number, number>(); // any ID → canonical ID
    const byBaseName = new Map<string, number>();
    for (const func of profile.Function) {
        const base = func.Name.replace(/\[.*\]/, '');
        if (!byBaseName.has(base)) byBaseName.set(base, func.ID);
        canonical.set(func.ID, byBaseName.get(base)!);
    }

    return {
        ...profile,
        Function: profile.Function.filter((f) => canonical.get(f.ID) === f.ID).map(func => ({
			...func,
			Name: func.Name.replace(/\[.*\]/, ''),
		})),
        Location: profile.Location.map((loc) => ({
            ...loc,
            Line: loc.Line.map((line) => ({
                ...line,
                Function: canonical.get(line.Function) ?? line.Function,
            })),
        })),
    };
}