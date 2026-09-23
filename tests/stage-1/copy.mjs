/**
 * The copy of the scenario stage 1 compiles and edits, and where its artifacts are written.
 *
 * Importing this module copies the permanent scenario, without its artifacts, into a unique temporary
 * directory, so a failed or interrupted run leaves the scenario as it was. Only stage 1 imports it; other
 * validations use the step infrastructure of `harness.mjs`, which has no side effect. `release()` removes the
 * copy.
 */
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testbed } from './harness.mjs';

export const directory = await realpath(await mkdtemp(join(tmpdir(), 'beyond-stage1-')));
await cp(testbed, directory, { recursive: true, filter: source => !source.includes('/.artifacts') });

export const artifactsPath = join(directory, '.artifacts');

/**
 * Removes the copy of the scenario
 */
export const release = () => rm(directory, { recursive: true, force: true });
