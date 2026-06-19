/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import { Context } from '@/utils/common';
import { getTempDirPath } from '@/utils/util';
import { createHash } from 'crypto';
import { TestRun, Uri } from 'vscode';

const captureDirs = new WeakMap<TestRun, Map<Uri, Uri>>();

/**
 * Creates a storage directory for captures taken during a test run.
 *
 * Ideally, if the test run is persisted and supports onDidDispose, it would
 * return the extensions's storage URI. However there are issues with that (see
 * the comment in the function).
 *
 * @param context - The context object.
 * @param run - The test run object.
 * @returns The storage directory URI.
 */
export async function makeCaptureDir(context: Context, run: TestRun, scope: Uri, time: Date): Promise<Uri> {
	// Avoid multiple FS calls
	let cache = captureDirs.get(run);
	if (!cache) {
		cache = new Map();
		captureDirs.set(run, cache);
	}
	if (cache.has(scope)) {
		return cache.get(scope)!;
	}

	const tmp = captureTempDir();

	// This is a simple way to make an ID from the package URI
	const hash = createHash('sha256').update(`${scope}`).digest('hex');
	const dir = Uri.joinPath(tmp, `${hash.substring(0, 16)}-${time.getTime()}`);

	// Store before awaiting to avoid concurrency issues
	cache.set(scope, dir);

	const { fs } = context.workspace;
	await fs.createDirectory(dir);
	run.onDidDispose?.(() => fs.delete(dir, { recursive: true }));

	return dir;
}

function captureTempDir(): Uri {
	// Profiles can be deleted when the run is disposed, but there's no way to
	// re-associated profiles with a past run when VSCode is closed and
	// reopened. So we always use the OS temp directory for now.
	// https://github.com/microsoft/vscode/issues/227924

	// if (run.isPersisted && run.onDidDispose && context.storageUri) {
	// 	return context.storageUri;
	// }

	return Uri.file(getTempDirPath());
}
