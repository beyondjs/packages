import { Conditional } from '../main';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import Concat from 'concat-with-sourcemaps';
import { header } from './header';

export /*bundle*/ abstract class ESMConditional extends Conditional {
	#output: ConditionalOutput;
	get output(): ConditionalOutput {
		return this.#output;
	}

	_process() {
		const concat = new Concat(true, '', '\n');

		this.processors.forEach(processor => {
			processor.outputs.ims.forEach(im => {
				// const { id, hash } = im;
				const id = 'id';
				const hash = 'hash';

				const code = im.code.code();
				const map = im.code.map();

				concat.add('header', header(`INTERNAL MODULE: ${id}`));

				const creator = 'creator: function (require, exports) {';

				concat.add(null, `ims.set('${id}', {hash: ${hash}, ${creator}`);
				concat.add(im.source.relative.file, code, map);
				concat.add(null, '}});\n');
			});
		});

		const code = concat.content.toString();
		const map = concat.sourceMap;

		this.#output = new ConditionalOutput();
		this.#output.set({ code, map });
	}
}
