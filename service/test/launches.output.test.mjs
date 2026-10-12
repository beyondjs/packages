import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Output } from '../host/launches/output.mjs';

/**
 * The output of a launch: the ring of its last lines, lines as a terminal shows them, and the cadence of announcements
 */

const clock = { now: () => Date.parse('2026-10-11T12:00:00Z') };
const lines = count => Array.from({ length: count }, (value, index) => `line ${index + 1}\n`).join('');

test('the last lines are kept, numbered, and a reader is told how many it lost', () => {
	const output = new Output({ clock });
	output.write('stdout', lines(1500));
	assert.equal(output.next, 1500);

	const all = output.read(0);
	assert.equal(all.lines.length, Output.LIMIT);
	assert.deepEqual(all.lines[0], { seq: 501, stream: 'stdout', text: 'line 501', time: '2026-10-11T12:00:00.000Z' });
	assert.deepEqual([all.next, all.dropped], [1500, 500]);

	assert.deepEqual(output.read(1500), { lines: [], next: 1500, dropped: 0 });
	const recent = output.read(1200);
	assert.deepEqual([recent.lines.length, recent.lines[0].seq, recent.dropped], [300, 1201, 0]);
	assert.equal(output.read(100).dropped, 400);
	assert.deepEqual(output.read(5000), { lines: [], next: 1500, dropped: 0 }, 'a reader ahead of the output is brought back to it');
	assert.deepEqual(new Output().read(0), { lines: [], next: 0, dropped: 0 });
});

test('a line is what a terminal shows: control sequences removed, the last rewrite of a line, cut at its width', () => {
	const output = new Output({ clock });
	output.write('stdout', '\u001b[32mgreen\u001b[0m text\r\n');
	output.write('stdout', 'progress 10%\rprogress 50%\rprogress 100%\n');
	output.write('stdout', '\u001b]0;a window title\u0007titled\tline\u0000\n');
	output.write('stdout', `${'x'.repeat(5000)}\n`);
	output.write('stderr', 'after the long one\n');
	const read = output.read(0).lines.map(line => line.text);
	assert.deepEqual(read.slice(0, 3), ['green text', 'progress 100%', 'titled\tline']);
	assert.equal(read[3].length, Output.WIDTH);
	assert.ok(read[3].endsWith('…'));
	assert.equal(read[4], 'after the long one');
});

test('a line that grows past its width without ending is cut once, and the rest of it is not kept', () => {
	const output = new Output({ clock });
	output.write('stdout', 'y'.repeat(1500));
	output.write('stdout', 'y'.repeat(1500));
	output.write('stdout', 'y'.repeat(1500));
	output.write('stdout', 'the rest of the long line\nthe next line\n');
	const read = output.read(0).lines;
	assert.deepEqual(read.map(line => [line.seq, line.text.length]), [[1, Output.WIDTH], [2, 'the next line'.length]]);
	assert.equal(read[1].text, 'the next line');
});

test('every line and the incomplete one are observed; the end of a stream makes the incomplete one a line', () => {
	const observed = [];
	const output = new Output({ clock, observe: text => observed.push(text) });
	output.write('stdout', 'stand-in ');
	output.write('stdout', 'listening');
	assert.deepEqual(observed, ['stand-in ', 'stand-in listening'], 'a readiness written without a final newline is seen');
	output.write('stderr', 'an error\n');
	output.end('stdout');
	assert.deepEqual(output.read(0).lines.map(({ stream, text }) => [stream, text]), [['stderr', 'an error'], ['stdout', 'stand-in listening']]);
	assert.deepEqual(output.tail(5), ['[stderr] an error', 'stand-in listening']);
	assert.deepEqual(output.tail(1), ['stand-in listening']);
});

test('new lines are announced at most once per cadence, and closing announces what waits', async () => {
	let announced = 0;
	const output = new Output({ announce: () => announced++ });
	output.write('stdout', lines(50));
	assert.equal(announced, 1, 'the first lines are announced at once');
	output.write('stdout', lines(50));
	assert.equal(announced, 1, 'the next ones wait for the cadence');

	await new Promise(resolve => setTimeout(resolve, Output.CADENCE + 100));
	assert.equal(announced, 2);
	output.write('stdout', 'one more\n');
	assert.equal(announced, 2);
	output.close();
	assert.equal(announced, 3, 'closing announces what waited');
	output.close();
	assert.equal(announced, 3);
});
