import PContent from './package';

module.exports = new (class {
	#packages = new Map();

	get(pkg: string, version: string): PContent {
		if (!pkg || !version) throw new Error('Invalid parameters');

		const vpkg = `${pkg}@${version}`;
		if (this.#packages.has(vpkg)) return this.#packages.get(vpkg);

		const item = new PContent(pkg, version);
		this.#packages.set(vpkg, item);
		return item;
	}
})();
