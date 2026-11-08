/**
 * The type of `import.meta.hot` in the program of a module: the update API the development runtime gives each source
 * while it applies updates, undefined otherwise (`Meta` of the `ts` processor). It is a global declaration of the
 * program, held in memory like the declarations of the imported modules, and never part of the public declaration.
 */
export class Hot {
	static FILE = 'import-meta-hot.d.ts';

	static DECLARATION = `interface ImportMetaHot {
	/** What this source kept for its next evaluation: the same object every evaluation reads, given to \`dispose\` */
	readonly data: Record<string, any>;
	/** This source accepts its own updates: it is evaluated again, after \`dispose\`, instead of reloading what runs it */
	accept(callback?: (exports: Record<string, any>) => void): void;
	/** Runs before this source is evaluated again or the program reloads, to release what it holds and keep its state */
	dispose(callback: (data: Record<string, any>) => void): void;
}

interface ImportMeta {
	/** The update API of this source, undefined where no development runtime applies updates */
	readonly hot?: ImportMetaHot;
}
`;
}
