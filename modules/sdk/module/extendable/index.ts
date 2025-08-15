import { Module as ModuleBase } from '';

export /*bundle*/ class Module extends ModuleBase {
	_processors() {
		throw new Error(`Private method '_processors' must be overriden`);
	}
}
