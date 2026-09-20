import type { IItem, IKeyInputs } from './types';
import type { Opened } from './pinned/opened';
import { Compatibility } from './compatibility';
import { Toolchain } from './toolchain';

const MEDIA = { module: 'text/javascript', style: 'text/css' };

/**
 * The identity of an inventory item and the inputs of its key, built the same way when a module is traced
 * and when it is generated, so both always arrive at the same key.
 */
export /*bundle*/ class Keyed {
	/**
	 * A public subpath as the inventory writes it: `.` or the subpath without its leading `./`
	 */
	static subpath(declared: string): string {
		return declared === '.' ? '.' : declared.replace(/^\.\//, '');
	}

	/**
	 * A subpath of the inventory as a package declares it: `.` or `./name`
	 */
	static declared(subpath: string): string {
		return subpath === '.' || subpath.startsWith('./') ? subpath : `./${subpath}`;
	}

	static id(kind: IItem['kind'], key: string, subpath: string): string {
		return `${kind}:${key}/${Keyed.subpath(subpath)}`;
	}

	/**
	 * The specifier a consumer imports for a module item: the package name of its node key and its subpath
	 */
	static specifier(item: Pick<IItem, 'package' | 'subpath'>): string {
		const name = item.package.slice(item.package.indexOf(':') + 1).replace(/@[^@/]+$/, '');
		return item.subpath === '.' ? name : `${name}/${Keyed.subpath(item.subpath)}`;
	}

	/**
	 * The inputs of the key of one output of a package
	 *
	 * @param subpath The public subpath, or the path of an asset
	 * @returns undefined when the package has no integrity, which a diagnostic of the caller explains
	 */
	static inputs(opened: Opened, subpath: string, resolution: Record<string, string>, described: Pick<IKeyInputs, 'compiler' | 'conditions' | 'format'>, output: IKeyInputs['output']): IKeyInputs | undefined {
		if (!opened.integrity) return;
		const sorted = Object.fromEntries(Object.entries(resolution).sort(([a], [b]) => (a < b ? -1 : 1)));
		return Object.assign({ module: `${opened.key}/${Keyed.subpath(subpath)}`, sources: [opened.integrity], resolution: sorted, output }, described);
	}

	/**
	 * An item with its key, not yet classified as eager or lazy nor related to the entries
	 */
	static item(kind: IItem['kind'], opened: Opened, subpath: string, inputs: IKeyInputs, media?: string): IItem {
		const id = Keyed.id(kind, opened.key, subpath);
		return { id, kind, package: opened.key, subpath: Keyed.subpath(subpath), loading: 'lazy', targets: [], media: media ?? MEDIA[<'module' | 'style'>kind], inputs, key: Compatibility.key(inputs) };
	}

	static asset(opened: Opened, path: string, media: string): IItem | undefined {
		const inputs = Keyed.inputs(opened, path, {}, Toolchain.copied, 'asset');
		return inputs && Keyed.item('asset', opened, path, inputs, media);
	}
}
