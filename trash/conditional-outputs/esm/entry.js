/**
 * Entry module builder for a set of internal modules (ims)
 */
module.exports = class {
	#ims;

	#code;
	get code() {
		return this.#code;
	}

	constructor(ims) {
		this.#ims = ims;
		this.#code = this.#build();
	}

	#build() {
		const lines = [];

		this.#ims.forEach(im => {
			const { exports } = im.generated;
			const module = im.source.relative.file;
			if (!exports.size) return;

			const def = exports.has('default');
			const named = [...exports].filter(e => e !== 'default');

			if (def && !named.length === 0) {
				lines.push(`import def from './${module}'; export default def;`);
			} else if (def && named.length > 0) {
				lines.push(`import def, { ${named.join(', ')} } from './${module}';`);
				lines.push(`export default def;`);
				lines.push(`export { ${named.join(', ')} };`);
			} else {
				lines.push(`export { ${named.join(', ')} } from './${module}';`);
			}
		});

		return lines.join('\n');
	}
};
