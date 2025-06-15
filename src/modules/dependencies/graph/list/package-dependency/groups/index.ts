import type { DependenciesNode } from '../../../node';
import { Group } from './group';
import { compare } from 'semver';

export class Groups extends Array<Group> {
	#versions: string[];

	constructor(versions: string[]) {
		super();
		this.#versions = versions;
	}

	register(node: DependenciesNode) {
		const done = (group?: Group) => {
			group = (() => {
				if (group) return group;

				group = new Group(this.#versions);
				this.push(group);
				return group;
			})();

			group.register(node);
		};

		if (!this.length) return done();

		const valid = this.filter(group => group.intersects(node.version.specified));
		if (!valid.length) return done();

		valid.sort((a, b) => compare(b.max, a.max));
		done(valid[0]);
	}

	unregister(node: DependenciesNode) {
		const group = this.find(group => group.find((n: DependenciesNode) => n === node));
		if (!group) throw new Error('Node in the dependencies tree has not been found in any of its groups');

		group.unregister(node);
		!group.length && this.splice(this.indexOf(group), 1);
	}
}
