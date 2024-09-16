import { env, ExtensionContext, Uri, WebviewPanel, window } from 'vscode';
import axios from 'axios';
import { HTMLElement, parse } from 'node-html-parser';
import { Tail } from './test/testing';

// TODO(firelizzard18): Disable back/forward when not applicable

export class Browser {
	static open = new Set<Browser>();

	static get active() {
		return [...this.open].find((x) => x.panel.active);
	}

	readonly #extension: ExtensionContext;
	readonly #id: string;
	readonly #base: Uri;
	readonly panel: WebviewPanel;

	constructor(
		extension: ExtensionContext,
		id: string,
		base: Uri,
		...options: Tail<Parameters<typeof window.createWebviewPanel>>
	) {
		this.#extension = extension;
		this.#id = id;
		this.#base = base;
		this.panel = window.createWebviewPanel('goExp.browser', ...options);

		Browser.open.add(this);
		this.panel.onDidDispose(() => Browser.open.delete(this));

		this.panel.webview.options = { enableScripts: true };
		this.panel.webview.onDidReceiveMessage(async (e) => {
			switch (e.command) {
				case 'navigate': {
					this.navigate(e.url);
					break;
				}
			}
		});
	}

	show(html: string) {
		this.panel.webview.html = ' ';
		this.panel.webview.html = html;
	}

	readonly #history: Uri[] = [];
	readonly #unhistory: Uri[] = [];
	#current?: Uri;

	navigate(url: Uri | string) {
		url = this.#parseUrl(url);
		this.#load(url)
			.then((ok) => {
				if (!ok) return;
				this.#current = url;
				this.#history.push(url);
				this.#unhistory.splice(0, this.#unhistory.length);
			})
			.catch((e) => console.error('Navigation failed', e));
	}

	back() {
		if (this.#history.length < 2) {
			return;
		}

		const url = this.#history[this.#history.length - 2];
		this.#load(url)
			.then((ok) => {
				if (!ok) return;
				this.#current = url;
				this.#unhistory.push(this.#history.pop()!);
			})
			.catch((e) => console.error('Navigate back failed', e));
	}

	forward() {
		if (this.#unhistory.length < 1) {
			return;
		}

		const url = this.#unhistory[this.#unhistory.length - 1];
		this.#load(url)
			.then((ok) => {
				if (!ok) return;
				this.#current = url;
				this.#history.push(this.#unhistory.pop()!);
			})
			.catch((e) => console.error('Navigate forward failed', e));
	}

	reload() {
		this.#load(this.#current!, true).catch((e) => console.error('Refresh', e));
	}

	#parseUrl(url: Uri | string) {
		if (url instanceof Uri) {
			return url;
		}

		if (url.startsWith('./') || url.startsWith('../')) {
			return Uri.joinPath(this.#base, url);
		}
		if (url.startsWith('/')) {
			return this.#base.with({ path: url });
		}
		if (url.startsWith('#') || url.startsWith('?')) {
			const { query, fragment } = Uri.parse(`foo://bar${url}`);
			return (this.#current || this.#base).with({ query, fragment });
		}

		return Uri.parse(url);
	}

	async #load(url: Uri, reload = false): Promise<boolean> {
		if (!reload && `${url}` === `${this.#current}`) {
			this.panel.webview.postMessage({
				command: 'jump',
				fragment: url.fragment
			});
			return true;
		}

		// Fetch data. Ignore empty responses.
		const { data } = await axios.get<string>(url.toString(true));
		if (!data) return false;

		// Process the response. Note, the response may not include <body>.
		const document = parse(data);
		document.querySelector('html')?.setAttribute('id', this.#id);

		// Preserve links
		document.querySelectorAll('a[href]').forEach((a) => {
			const href = a.getAttribute('href')!;
			a.removeAttribute('href');
			a.setAttribute('data-href', href);
		});

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

		// Add resources
		head.appendChild(parse(`<script src="${this.#contentUri('main.js')}"></script>`));
		head.appendChild(parse(`<link rel="stylesheet" href="${this.#contentUri('main.css')}" />`));

		// Extract scripts
		const scripts = document.querySelectorAll('html > script, html > :not(head) script');
		scripts.forEach((x) => x.remove());

		// Call the post-load function and insert scripts
		document.appendChild(parse(`<script>didLoad("${url.fragment}")</script>`));
		scripts.forEach((x) => document.appendChild(x));

		this.show(`${document}`);
		return true;
	}

	#contentUri(...path: string[]) {
		const uri = Uri.joinPath(this.#extension.extensionUri, 'webview', 'browser', ...path);
		return this.panel.webview.asWebviewUri(uri);
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
