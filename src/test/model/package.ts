import path, { posix } from 'node:path';
import { Uri } from 'vscode';

import { type Commands } from '@/utils/common';
import { isRelativePath } from '@/utils/util';

import type { Module, TestFile, Workspace } from '.';
import { findParentTest, findTestByName } from './case';
import { ItemSet } from './set';

export class Package {
	readonly kind = 'package';
	readonly root;
	readonly uri;
	readonly path;
	readonly files = new ItemSet<TestFile>();

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
				throw new Error('Package is not contained within Workspace');
			}
			this.uri = Uri.joinPath(parent.dir, rel);
		} else {
			throw new Error('Package parent is a module but does not have a module path');
		}
	}

	static keyOf(x: Commands.Package) {
		return x.Path;
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

	/** Yields every test in the package, including nested subtests. */
	*allTests() {
		for (const file of this.files) {
			yield* file.allTests();
		}
	}

	/** Finds a test in the package by its full name. */
	findTest(name: string) {
		for (const file of this.files) {
			const test = findTestByName(file.tests, name);
			if (test) return test;
		}
	}

	/** Finds the nearest existing ancestor of a test name. */
	findParent(name: string) {
		for (const file of this.files) {
			const test = findParentTest(file.tests, name);
			if (test) return test;
		}
	}
}
