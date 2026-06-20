import { TestRun } from 'vscode';
import { Package, TestCase } from '../model';

export type RunEvent =
	| {
			type: 'start';
			run: TestRun;
			pkg: Package;
			include?: Set<TestCase>;
			exclude?: Set<TestCase>;
	  }
	| {
			type: 'subtest';
			run: TestRun;
			pkg: Package;
			name: string;
	  }
	| {
			type: 'disposed';
			run: TestRun;
			pkg: Package;
	  };
