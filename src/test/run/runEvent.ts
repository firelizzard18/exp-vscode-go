import { TestRun } from 'vscode';
import { GoTestItem, Package, TestCase } from '../model';
import { CapturedProfile } from '../profiles';

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
			type: 'captured';
			run: TestRun;
			pkg: Package;
			scope: GoTestItem;
			profile: CapturedProfile;
	  }
	| {
			type: 'disposed';
			run: TestRun;
			pkg: Package;
	  };
