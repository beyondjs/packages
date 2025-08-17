export class Propagator {
	#listeners = new Map();

	constructor(emitter) {
		const events = [
			'conditional.change',
			'dependencies.change',
			'dependency.change',
			'js.change',
			'css.change',
			'hash.change'
		];
		events.forEach(event => this.#listeners.set(event, (...params) => emitter.emit(event, ...params)));
	}

	subscribe(conditional) {
		const listeners = this.#listeners;
		conditional.on('change', listeners.get('conditional.change'));
		conditional.dependencies.on('change', listeners.get('dependencies.change'));
		conditional.dependencies.on('dependency.change', listeners.get('dependency.change'));
		conditional.js?.on('change', listeners.get('js.change'));
		conditional.css?.on('change', listeners.get('css.change'));
		conditional.hash.on('change', listeners.get('hash.change'));
	}

	unsubscribe(conditional) {
		const listeners = this.#listeners;
		conditional.off('change', listeners.get('conditional.change'));
		conditional.dependencies.off('change', listeners.get('dependencies.change'));
		conditional.dependencies.off('dependency.change', listeners.get('dependency.change'));
		conditional.js?.off('change', listeners.get('js.change'));
		conditional.css?.off('change', listeners.get('css.change'));
		conditional.hash.off('change', listeners.get('hash.change'));
	}
}
