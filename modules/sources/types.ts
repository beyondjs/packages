import type { Readable } from 'stream';

/**
 * Where a source is kept: `public`, or `org:<tenant>` for what was obtained with credentials. The scope
 * is part of every lookup and never part of the key.
 */
export /*bundle*/ type StoreScope = string;

export /*bundle*/ interface IStoreRecord {
	// `origin/name/version/integrity`
	key: string;
	scope: StoreScope;
	origin: string;
	name: string;
	version: string;
	integrity: string;
}

/**
 * What a store keeps about a published source
 */
export /*bundle*/ interface IStoredSource extends IStoreRecord {
	// Compressed bytes of the verified archive
	bytes: number;
	// Bytes of the extracted files
	extracted: number;
	// Archive entries, including directories
	entries: number;
	// Extracted files, relative to the package root, with their sizes
	files: Record<string, number>;
	// Where the adapter keeps the files, when that is meaningful to its consumers
	location?: string;
}

/**
 * A source being written. Nothing written to a stage is visible through `has` or `get` until the stage
 * is committed; a discarded stage leaves nothing behind.
 */
export /*bundle*/ interface IStoreStage {
	/**
	 * Writes one file of the package
	 *
	 * @param path Relative path, already validated, with '/' separators
	 * @returns The bytes written
	 */
	write(path: string, content: Readable): Promise<number>;
}

/**
 * Durable storage of verified package sources. Implementations: `FilesystemStore`, or any adapter of the
 * consumer (object storage, for example). Publishing must be atomic: a reader sees a complete source or
 * none.
 */
export /*bundle*/ interface IStore {
	has(record: IStoreRecord): Promise<boolean>;
	get(record: IStoreRecord): Promise<IStoredSource | undefined>;
	/**
	 * Opens a stage to write a source into
	 */
	put(record: IStoreRecord): Promise<IStoreStage>;
	/**
	 * Publishes a stage atomically. When the source was published meanwhile, the stage is discarded and
	 * the published one is returned.
	 */
	commit(stage: IStoreStage, source: IStoredSource): Promise<IStoredSource>;
	/**
	 * Removes everything a stage wrote
	 */
	discard(stage: IStoreStage): Promise<void>;
}

export /*bundle*/ interface ILimits {
	// Compressed bytes of one archive. Default 64 MiB
	compressed?: number;
	// Extracted bytes of one archive. Default 256 MiB
	extracted?: number;
	// Entries of one archive, directories included. Default 20000
	entries?: number;
	// Milliseconds one download may take. Default 120000
	timeout?: number;
	// Simultaneous downloads. Default 6
	concurrency?: number;
}

export /*bundle*/ interface ISourceResult {
	// Key of the graph node
	node: string;
	// Store key: `origin/name/version/integrity`
	key: string;
	scope: StoreScope;
	integrity: string;
	bytes: number;
	extracted: number;
	entries: number;
	// True when the store already held the verified source: nothing was downloaded
	reused: boolean;
	// True when the graph published no integrity (a recorded exception) and it was computed at fetch
	established?: boolean;
}

export /*bundle*/ interface ISourceDiagnostic {
	code: string;
	message: string;
	// Key of the graph node concerned, when there is one
	node?: string;
}

export /*bundle*/ interface ISourcesReport {
	protocol: 'beyond-sources/1';
	// Digest of the graph the sources belong to
	graph: string;
	// True when every package of the graph is in the store, verified
	complete: boolean;
	packages: ISourceResult[];
	diagnostics: ISourceDiagnostic[];
}
