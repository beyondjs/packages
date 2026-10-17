import { readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Lines of a source around a position: what a client shows under a diagnostic as its code frame
 */
export /*bundle*/ interface IFrame {
	/**
	 * The one-based line and column the diagnostic is about
	 */
	line: number;
	column: number;

	/**
	 * The line before, the line and the line after, as far as the file has them, with their one-based numbers
	 */
	lines: { number: number; text: string }[];
}

/**
 * Reads the lines around a position of a file of the served root. The file is read when the diagnostic is
 * reported, so the lines are those of the text on disk then, which the revision of the diagnostic names; a file
 * that cannot be read, is larger than `Frame.LIMIT` or does not reach the line gives no frame.
 */
export class Frame {
	static LIMIT = 1024 * 1024;
	static AROUND = 1;

	/** The longest line kept, so a minified source does not travel whole */
	static WIDTH = 400;

	#root: string;

	constructor(root: string) {
		this.#root = root;
	}

	of(path: string, { line, column }: { line: number; column: number }): IFrame | undefined {
		let text: string;
		try {
			const file = join(this.#root, path);
			if (statSync(file).size > Frame.LIMIT) return;
			text = readFileSync(file, 'utf8');
		} catch {
			return;
		}

		const all = text.split(/\r?\n/);
		if (!Number.isInteger(line) || line < 1 || line > all.length) return;

		const first = Math.max(1, line - Frame.AROUND);
		const last = Math.min(all.length, line + Frame.AROUND);
		const lines = [];
		for (let number = first; number <= last; number++) lines.push({ number, text: all[number - 1].slice(0, Frame.WIDTH) });
		return { line, column, lines };
	}
}
