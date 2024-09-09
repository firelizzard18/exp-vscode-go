import { env, ExtensionContext, Uri, WebviewPanel } from 'vscode';
import axios from 'axios';
import { HTMLElement, parse } from 'node-html-parser';
import path from 'path';

export class Browser {
	readonly #extension: ExtensionContext;
	readonly #panel: WebviewPanel;
	readonly #base: Uri;

	constructor(extension: ExtensionContext, panel: WebviewPanel, base: Uri) {
		this.#extension = extension;
		this.#panel = panel;
		this.#base = base;
		panel.webview.options = { enableScripts: true };

		panel.webview.onDidReceiveMessage(async (e) => {
			switch (e.command) {
				case 'navigate': {
					this.navigate(e.url);
					break;
				}

				// case 'back':
				// 	this.#back();
				// 	break;

				// case 'forward':
				// 	this.#forward();
				// 	break;

				// case 'reload':
				// 	this.#reload();
				// 	break;
			}
		});
	}

	async navigate(url: Uri | string) {
		if (typeof url === 'string') {
			const s = url;
			url = Uri.parse(url);
			if (url.scheme === 'file') {
				if (path.isAbsolute(s)) {
					url = this.#base.with({ path: s });
				} else {
					url = Uri.joinPath(this.#base, s);
				}
			}
		}

		await this.#load(url)
			.then((ok) => {
				if (!ok) return;
			})
			.catch((e) => console.error('Navigation failed', e));
	}

	async #load(url: Uri): Promise<boolean> {
		// Fetch data. Ignore empty responses.
		const { data } = await axios.get<string>(`${url}`);
		if (!data) return false;

		// Process the response. Note, the response may not include <body>.
		const document = parse(data);

		// Preserve links
		document.querySelectorAll('html > *:not(head) a[href]').forEach((a) => {
			const href = a.getAttribute('href')!;
			a.removeAttribute('href');
			a.setAttribute('data-href', href);
		});

		document.querySelector('body')!.appendChild(parse('<script>console.log("Hi")</script>'));

		// Add the base URL to head children
		const head = document.querySelector('head')!;
		const base = (await env.asExternalUri(url.with({ path: '', query: '', fragment: '' })))
			.toString(true)
			.replace(/\/$/, '');
		fixLinks(head, (s: string) => (s.startsWith('/') ? `${base}${s}` : s));

		// Add <base> to fix queries
		head.appendChild(parse(`<base href="${base}" />`));

		// Transfer variables
		head.appendChild(parse(`<script>window.pageStr = "${url}";</script>`));

		// Call the post-load function
		document.appendChild(parse(`<script>didLoad("${url.fragment}")</script>`));

		// Update the webview (trigger a reload)
		if (this.#panel.webview.html) {
			this.#panel.webview.postMessage({ command: 'load', content: `${document}` });
		} else {
			// Add resources
			head.appendChild(parse(`<script src="${this.#contentUri('main.js')}"></script>`));
			head.appendChild(parse(`<link rel="stylesheet" href="${this.#contentUri('main.css')}" />`));

			this.#panel.webview.html = `${document}`;
		}
		return true;
	}

	#contentUri(...path: string[]) {
		const uri = Uri.joinPath(this.#extension.extensionUri, 'webview', 'browser', ...path);
		return this.#panel.webview.asWebviewUri(uri);
	}
}

function fixLinks(elem: HTMLElement | null | HTMLElement[], fix: (url: string) => string) {
	if (!elem) return;
	if (Array.isArray(elem)) {
		elem.forEach((e) => fixLinks(e, fix));
		return;
	}

	if (elem.attrs.href) {
		elem.setAttribute('href', fix(elem.attrs.href));
	}
	if (elem.attrs.src) {
		elem.setAttribute('src', fix(elem.attrs.src));
	}

	for (const node of elem.childNodes) {
		if (node instanceof HTMLElement) {
			fixLinks(node, fix);
		}
	}
}
