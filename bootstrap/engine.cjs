/**
 * Starts the Engine development server for the project of the working directory.
 *
 * It is the published Engine entry point reduced to what the bootstrap needs: the installed `beyond` package
 * distributes its library and its command, not the `index.js` of its repository, and its `run` command opens
 * an inspector port that a supervised bootstrap neither needs nor may assume to be free.
 *
 * Usage: node engine.cjs <directory of the installed beyond package>
 */
const { join } = require('node:path');

const engine = process.argv[2];
require(join(engine, 'lib', 'global'));
new (require(join(engine, 'lib', 'index.js')))({ inspect: undefined });
