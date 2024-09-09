/* eslint-disable prettier/prettier */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

const vscode = acquireVsCodeApi();

const goTo = (url) => vscode.postMessage({ command: 'navigate', url });
const goBack = () => vscode.postMessage({ command: 'back' });
const goForward = () => vscode.postMessage({ command: 'forward' });
const reload = () => vscode.postMessage({ command: 'reload' });
const jumpTo = (hash) => (location.hash = hash);

addEventListener('message', (event) => {
	switch (event.data.command) {
		case 'jump':
			jumpTo(event.data.fragment);
			break;
		case 'load': {
			document.write(event.data.content);
			break;
		}
	}
});

function didLoad(fragment) {
	if (fragment) {
		jumpTo(fragment);
	}

	document.querySelectorAll(`a[href^="${pageStr}#"]`).forEach((el) => {
		const s = el.getAttribute('href');
		el.setAttribute('href', s.replace(`${pageStr}`, ''));
	});

	document.querySelectorAll('a[href^="#"]').forEach((el) => {
		el.addEventListener('click', (event) => {
			goTo(`${pageStr}` + el.getAttribute('href'));
		});
	});

	document.querySelectorAll('a:not([href^="#"])').forEach((el) => {
		el.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			goTo(el.dataset.href || el.getAttribute('href'));
		});
	});
}
