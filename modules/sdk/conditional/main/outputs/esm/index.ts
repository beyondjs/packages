import { Output } from '@beyond-js/bundlers-sdk/conditional/output';
import { InternalModules } from '@beyond-js/bundlers-sdk/bundler/ims';
import { esbuild } from 'esbuild';
import { ESBuildPlugin } from './esbuild-plugin';
import { Entry } from './entry';

export class ESMOutput extends Output {
	get dp() {
		return 'bundler.output.esm';
	}

	#ims;

	constructor(...args) {
		super(...args);
		this.#ims = new InternalModules(this.conditional.processors);
		super.setup(new Map([['ims', { child: this.#ims }]]));
	}

	async _process(request) {
		const entry = new Entry(this.#ims);
		const plugin = new ESBuildPlugin(this.conditional, this.#ims, entry);

		const result = await esbuild.build({
			entryPoints: ['entry-point'],
			bundle: true,
			write: false,
			format: 'esm',
			outfile: 'out.js',
			plugins: [plugin]
		});
		if (this._request !== request) return;

		console.log('ESBuild result:', result.outputFiles?.[1].text);
		return result.outputFiles?.[0].text;
	}
}
