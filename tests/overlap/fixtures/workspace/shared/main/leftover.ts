// A file of the directory that no entry imports: it is compiled into neither artifact
(<{ evaluations?: string[] }>globalThis).evaluations?.push('leftover');

export const unused = true;
