/**
 * The entry point of the backend target. The validation resolves it and never runs it; evaluated, it says it is ready.
 */
import { message } from '@applications/shared/message';

console.log(`applications api listening: ${message('node')}`);
