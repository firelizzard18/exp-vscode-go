/* eslint-disable @typescript-eslint/no-unused-vars */
import './main.css';
import { createElement, render } from './jsx';
import { Boxes } from './Boxes';

function Main() {
	return (
		<Boxes
			scale={window.devicePixelRatio || 1}
			focusColor="--vscode-focusBorder"
			primaryColor="--vscode-charts-red"
		/>
	);
}

render(<Main />, document.body);
