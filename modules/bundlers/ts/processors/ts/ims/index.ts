import swc from '@swc/core';
import { IMOutputsBase } from '@beyond-js/packages/sdk/processor/outputs/ims';
import { Exports } from './exports';

export class InternalModules extends IMOutputsBase {
	async #item(item) {
		const tsx = item.source.extaname === '.tsx';

		try {
			const exports = new Exports();
			await exports.process(item);

			// Transpile the TypeScript/TSX code to javascript
			const result = await swc.transform(item.source.content, {
				filename: item.source.file,
				jsc: {
					target: 'es2022',
					parser: { syntax: 'typescript', tsx },
					transform: {},
					minify: { compress: false }
				},
				module: { type: 'es6' },
				sourceMaps: true
			});

			const { code, map } = result;
			item.generated.set({ code, map, exports });
		} catch (error) {
			item.issues.push('error', {
				code: 'TRANSPILE_ERROR',
				message: error.message
			});
		}
	}

	async _build(request, items) {
		const { warnings } = items;

		const tsconfig = this.processor.sources.files.get('tsconfig.json');
		if (!tsconfig.valid) {
			warnings.push({ code: 'INVALID_TSCONFIG', message: `The tsconfig.json file is invalid.` });
		}

		const promises = [];
		this.processor.sources.inputs.forEach(file => promises.push(this.#item(items.get(file))));
		await Promise.all(promises);
	}

	hydrate(cached) {
		super.hydrate(cached);
	}

	serialize() {
		super.serialize({});
	}
}
