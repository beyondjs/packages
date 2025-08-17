import { Module as ModuleBase } from '';

export /*bundle*/ class Module extends ModuleBase {
	#language: string;
	get language() {
		return this.#language;
	}

	_processors() {
		throw new Error(`Private method '_processors' must be overriden`);
	}
}
