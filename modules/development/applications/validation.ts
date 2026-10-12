import type { ICatalogApplication } from './types';
import { Diagnostics } from './diagnostics';
import { Targets } from './targets';

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The rules of the applications a workspace declares (`beyond-applications/1`): an object keyed by application
 * identifier (CDN's application name pattern), each application an object with an optional `title` and its `targets`,
 * keyed by target identifier ([Targets](./targets.ts)).
 *
 * Identity comes from the keys, never from a directory. A declaration with errors keeps every application and target:
 * an invalid one is listed with its diagnostics, never dropped. Fields this Core does not know are kept in the document
 * and reported as warnings (`APPLICATION_FIELD_UNKNOWN`, `TARGET_FIELD_UNKNOWN`).
 */
export class Validation {
	static ID = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
	static FIELDS = new Set(['title', 'targets']);
	static TITLE = 80;

	#targets = new Targets();

	/**
	 * Reads the applications of a declaration, in the order they are declared
	 */
	applications(value: Record<string, unknown>): ICatalogApplication[] {
		return Object.entries(value).map(([id, application]) => this.application(id, application));
	}

	/**
	 * Reads one application
	 */
	application(id: string, value: unknown): ICatalogApplication {
		const diagnostics = new Diagnostics();
		const application = <ICatalogApplication>{ id };
		if (!Validation.ID.test(id)) {
			const message =
				`${JSON.stringify(id)} is not an application identifier: lowercase letters, digits and inner hyphens, ` +
				'1 to 63 characters, starting and ending with a letter or a digit';
			diagnostics.error('APPLICATION_ID_INVALID', message);
		}
		if (!plain(value)) {
			diagnostics.error('APPLICATION_INVALID', `The application ${JSON.stringify(id)} is not an object of its title and targets`);
			return { ...application, targets: [], diagnostics: diagnostics.list };
		}

		const { title, targets } = value;
		typeof title === 'string' && (application.title = title);
		const valid = title === undefined || (typeof title === 'string' && !!title.trim() && title.length <= Validation.TITLE);
		valid || diagnostics.error('APPLICATION_TITLE_INVALID', 'The title of an application is text of 1 to 80 characters', 'title');

		application.targets = plain(targets) ? Object.entries(targets).map(([target, declared]) => this.#targets.read(target, declared)) : [];
		if (targets !== undefined && !plain(targets)) {
			const message = 'The targets of an application are an object keyed by target identifier';
			diagnostics.error('APPLICATION_INVALID', message, 'targets');
		}

		for (const field of Object.keys(value).filter(field => !Validation.FIELDS.has(field))) {
			const message = `The field ${JSON.stringify(field)} is not one this Core knows; it is kept as written`;
			diagnostics.warning('APPLICATION_FIELD_UNKNOWN', message, field);
		}
		return { ...application, diagnostics: diagnostics.list };
	}

	/**
	 * Whether an application or one of its targets has an error
	 */
	static failed({ diagnostics, targets }: ICatalogApplication): boolean {
		const errors = [...diagnostics, ...targets.flatMap(target => target.diagnostics)];
		return errors.some(({ severity }) => severity === 'error');
	}
}
