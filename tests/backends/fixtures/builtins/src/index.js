// CommonJS that requires Node builtins as most npm packages write them: by their bare names
const util = require('util');
const { readFile } = require('fs/promises');
const path = require('node:path');
const EventEmitter = require('events');

exports.inspect = value => util.inspect(value);
exports.reads = typeof readFile === 'function';
exports.joined = path.join('a', 'b');
// `require('events')` is the class itself, as packages that extend it (`sonic-boom`, Fastify's logger) expect
exports.emitter = typeof EventEmitter === 'function' && new EventEmitter() instanceof EventEmitter;
