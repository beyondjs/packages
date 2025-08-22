import { IExportsMap, IConditional, ExportsEntry, IConditions } from './types';
import { Module } from './module';
import { Conditional } from './conditional';

/**
 * A parser for the 'exports' field of package.json.
 * It transforms the raw exports structure into a collection of Modules.
 */
export /*bundle*/ class ExportsConditionalSpec {
	public modules: Module[] = [];

	/**
	 * Parses the raw exports data and populates the modules array.
	 */
	public parse(exports: ExportsEntry): void {
		if (typeof exports === 'string') {
			// Main export: the subpath is '.' and the condition is 'default'.
			const module = new Module('.');
			module.add(new Conditional({ default: 'true' }, exports));
			this.modules.push(module);
		} else if (typeof exports === 'object') {
			this.process(exports as IExportsMap, new Map());
		}
	}

	/**
	 * Recursively processes an exports object to build modules and conditionals.
	 * @param obj The exports object to process.
	 * @param parentConditions Conditions accumulated from parent objects.
	 */
	private process(obj: IExportsMap, parentConditions: Map<string, string>): void {
		for (const key in obj) {
			const value = obj[key];
			const newConditions = new Map(parentConditions).set(key, 'true');

			if (key.startsWith('.')) {
				// This key is a subpath, so we create a new Module for it.
				const module = new Module(key);
				this.resolve(module, value, new Map());
				this.modules.push(module);
			} else if (typeof value === 'string') {
				// This is a simple condition-target pair for the main export.
				const module = this.getOrCreateModule('.');
				module.add(new Conditional(this.toIConditions(newConditions), value));
			} else if (typeof value === 'object') {
				// This is a conditional object, nested or not.
				const module = this.getOrCreateModule('.');
				this.resolve(module, value, newConditions);
			}
		}
	}

	/**
	 * Resolves a nested conditional object and adds the resulting conditionals to a module.
	 * @param module The module to add the conditionals to.
	 * @param entry The entry to resolve (string or IExportsMap).
	 * @param conditions Conditions accumulated from parent objects.
	 */
	private resolve(module: Module, entry: ExportsEntry, conditions: Map<string, string>): void {
		if (typeof entry === 'string') {
			module.add(new Conditional(this.toIConditions(conditions), entry));
		} else if (typeof entry === 'object') {
			for (const key in entry) {
				const value = entry[key];
				const newConditions = new Map(conditions).set(key, 'true');
				this.resolve(module, value, newConditions);
			}
		}
	}

	/**
	 * Retrieves an existing module or creates a new one for a given subpath.
	 * @param subpath The subpath of the module.
	 * @returns The module instance.
	 */
	private getOrCreateModule(subpath: string): Module {
		let module = this.modules.find(m => m.subpath === subpath);
		if (!module) {
			module = new Module(subpath);
			this.modules.push(module);
		}
		return module;
	}

	/**
	 * Converts a Map of conditions to the IConditions interface format.
	 * @param conditions The conditions map.
	 * @returns The IConditions object.
	 */
	private toIConditions(conditions: Map<string, string>): IConditions {
		const result: IConditions = {};
		for (const [key, value] of conditions) {
			result[key] = value;
		}
		return result;
	}
}
