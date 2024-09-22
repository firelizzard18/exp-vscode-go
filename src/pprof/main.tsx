/* eslint-disable @typescript-eslint/no-unused-vars */
import './main.css';
import { createElement, render } from './jsx';
import { FlameGraph } from './FlameGraph';

function Main() {
	let profile: Profile;
	try {
		const el = document.getElementById('profile-data');
		profile = JSON.parse(el!.innerText);
	} catch (_) {
		return <span>Unable to locate profile data</span>;
	}

	return <FlameGraph profile={profile} />;
}

render(<Main />, document.body);
