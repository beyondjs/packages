import Index from './index';

type Source = {
	relative: { file: string };
	hash: string;
};

type CompilationResult = {
	compiled?: any;
	errors?: any[];
	data?: any;
};

export default class PackagerCompilerSingly extends Index {
	get dp(): string {
		return 'packager.compiler.singly';
	}

	protected async _compileSource(source: Source, is: string): Promise<CompilationResult> {
		void source;
		void is;
		throw new Error('This method should be overridden');
	}

	private async compile(
		is: string,
		source: Source,
		updated: Map<string, any>,
		diagnostics: Map<string, any[]>,
		meta: Map<string, any>,
		request: any,
	): Promise<void> {
		const { file } = source.relative;

		let compiled, errors, data;
		if (this[is].has(file) && this[is].get(file).hash === source.hash) {
			compiled = this[is].get(file);
			errors = this.diagnostics[is].get(file);
			data = this.meta[is].get(file);
		} else {
			const singular = is === 'files' ? 'source' : is === 'extensions' ? 'extension' : 'overwrite';
			const csource = await this._compileSource(source, singular, request);
			if (!csource) return;

			({ compiled, errors, data } = csource);
			if (!compiled && !errors) return;
		}

		if (compiled) updated[is].set(file, compiled);
		if (errors?.length) diagnostics[is].set(file, errors);
		if (data) meta[is].set(file, data);
	}

	async _compile(
		updated: Map<string, any>,
		diagnostics: Map<string, any[]>,
		meta: Map<string, any>,
		request: any,
	): Promise<void> {
		const { children } = this;

		let files, extensions, overwrites;
		if (children.has('analyzer')) {
			const analyzer = this.children.get('analyzer')?.child;
			({ files, extensions, overwrites } = analyzer || {});
		} else {
			files = children.get('files')?.child;
			extensions = children.get('extensions')?.child;
			overwrites = children.get('overwrites')?.child;
		}

		const process = async (sources: Map<string, Source>, is: string) => {
			for (const source of sources.values()) {
				await this.compile(is, source, updated, diagnostics, meta, request);
				if (this._request !== request) return;
			}
		};

		if (files) await process(files, 'files');
		if (extensions) await process(extensions, 'extensions');
		if (overwrites) await process(overwrites, 'overwrites');
	}
}
