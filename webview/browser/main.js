/* eslint-disable n/no-unsupported-features/node-builtins */
/* eslint-disable prettier/prettier */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

const vscode = acquireVsCodeApi();

const goTo = (url) => vscode.postMessage({ command: 'navigate', url });
const fetchOnly = (url) => vscode.postMessage({ command: 'fetch', url });
const goBack = () => vscode.postMessage({ command: 'back' });
const goForward = () => vscode.postMessage({ command: 'forward' });
const reload = () => vscode.postMessage({ command: 'reload' });
const jumpTo = (hash) => (location.hash = hash);

addEventListener('message', (event) => {
	switch (event.data.command) {
		case 'jump':
			jumpTo(event.data.fragment);
			break;
	}
});

function didLoad(fragment) {
	if (fragment) {
		jumpTo(fragment);
	}

	document.querySelectorAll('a[data-href]').forEach((el) => {
		el.setAttribute('href', el.dataset.href);

		// gopls jump to source
		const isFetchOnly = (el.getAttribute('onclick') || '').match(/^return httpGET\(/);
		if (isFetchOnly) el.removeAttribute('onclick');

		el.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopImmediatePropagation();

			if (isFetchOnly) {
				fetchOnly(el.dataset.href);
				return;
			}

			goTo(el.dataset.href);

			try {
				const from = new URL(pageStr);
				const to = new URL(el.dataset.href);
				if (from.origin !== to.origin || from.pathname !== to.pathname) {
					// Jump to the top when a new page is loaded
					window.scrollTo(0, 0);
				}
			} catch (_) {
				// Don't care
			}
		});
	});
}
