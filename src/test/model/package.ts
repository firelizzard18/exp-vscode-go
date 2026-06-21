import { Commands } from '@/utils/common';
import { isRelativePath } from '@/utils/util';
import path, { posix } from 'node:path';
import { Uri } from 'vscode';
import type { Module, TestFile, Workspace } from '.';
import { ItemSet } from './set';

export class Package {
	readonly kind = 'package';
	readonly root;
	readonly uri;
	readonly path;
	readonly files = new ItemSet<TestFile, Commands.TestFile>((x) => x.URI);

	constructor(parent: Module | Workspace, pkg: Commands.Package, mod?: Commands.Module) {
		this.root = parent;
		this.path = pkg.Path;

		if (pkg.ModulePath) {
			if (!mod) {
				throw new Error('Package specifies a module path but Module is missing');
			}
			const rel = posix.relative('/' + mod.Path, '/' + pkg.Path);
			if (rel.startsWith('../')) {
				throw new Error('Package is not within Module');
			}
			this.uri = Uri.joinPath(Uri.parse(mod.GoMod), '..', rel);
		} else if (parent.kind === 'workspace') {
			let p = pkg.Path;
			if (p.startsWith('_')) {
				p = p.substring(1);
			}
			const rel = path.relative(parent.dir.fsPath, p);
			if (!isRelativePath(rel)) {
				throw new Error(`Package is not contained within Workspace`);
			}
			this.uri = Uri.joinPath(parent.dir, rel);
		} else {
			throw new Error('Package parent is a module but does not have a module path');
		}
	}

	get key() {
		return this.path;
	}

	/**
	 * Returns whether the package is the root package of the parent.
	 */
	get isRootPkg() {
		return `${this.uri}` === `${this.root.dir}`;
	}

	*allTests() {
		for (const file of this.files) {
			yield* file.tests;
		}
	}

	/**
	 * Searches a set of tests for a test case that is the parent of the given
	 * test name.
	 */
	findParent(name: string) {
		for (;;) {
			const i = name.lastIndexOf('/');
			if (i < 0) return;
			name = name.substring(0, i);
			for (const test of this.allTests()) {
				if (test.name === name) {
					return test;
				}
			}
		}
	}
}
