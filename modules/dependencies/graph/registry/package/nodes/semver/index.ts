import type { DependencyPackage } from '../..';
import type { Node } from '../../../../node';
import { Group } from './group';
import { compare } from 'semver';

export class SemverNodes {
	#package: DependencyPackage;
	#groups: Group[] = [];

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	register(node: Node) {
		const done = (group?: Group) => {
			group = (() => {
				if (group) return group;

				group = new Group(this.#versions);
				this.#groups.push(group);
				return group;
			})();

			group.register(node);
		};

		if (!this.#groups.length) return done();

		const valid = this.#groups.filter(group => group.intersects(node.version.specified));
		if (!valid.length) return done();

		valid.sort((a, b) => compare(b.chosen, a.chosen));
		done(valid[0]);
	}

	unregister(node: Node) {
		const group = this.#groups.find(group => group.find((n: Node) => n === node));
		if (!group) throw new Error('Node in the dependencies tree has not been found in any of its groups');

		group.unregister(node);
		!group.length && this.#groups.splice(this.#groups.indexOf(group), 1);
	}
}
