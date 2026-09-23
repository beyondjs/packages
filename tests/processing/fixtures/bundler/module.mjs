/**
 * A bundler whose conditionals fail the way a defect in a real one would: by throwing, by rejecting, or through a
 * processor whose build throws. Read the README of these fixtures.
 */
import { BaseModule, Conditional } from '@beyond-js/packages/sdk';
import { ConditionalOutput } from '@beyond-js/packages/module/output';

const PROCESSOR = new URL('./processor.mjs', import.meta.url).href;

class Fixture extends Conditional {
	#output;
	get output() {
		return this.#output;
	}

	#artifact;

	/**
	 * What the delivery reads of an artifact: its identity, and that it imports nothing
	 */
	get artifact() {
		return this.#artifact;
	}

	#errors = [];
	get errors() {
		return this.#errors.concat(super.errors);
	}

	get valid() {
		return !this.#errors.length && super.valid;
	}

	_processors() {
		const processors = new Map();
		this.module.spec.subpath === './faulty' && processors.set('faulty', { specifier: PROCESSOR });
		return { processors };
	}

	_process() {
		const { subpath } = this.module.spec;
		if (subpath === './thrown') throw new Error('thrown by the fixture');
		if (subpath === './rejected') return Promise.reject(new Error('rejected by the fixture'));

		// A conditional reads the diagnostics of its processors, as the real ones do
		const errors = [];
		this.processors.forEach(processor => errors.push(...processor.errors));
		this.#errors = errors;
		if (errors.length) return true;

		const output = new ConditionalOutput();
		output.set({ code: `export const name = '${subpath.slice(2)}';\n` });
		this.#output = output;
		this.#artifact = { vspecifier: `${this.module.package.vname}/${subpath.slice(2)}`, dependencies: [], exports: ['name'], ims: [] };
		return true;
	}
}

export class Module extends BaseModule {
	_conditionals() {
		return [{ platform: 'web' }];
	}

	_conditional({ conditions }) {
		return new Fixture(this, conditions);
	}
}
