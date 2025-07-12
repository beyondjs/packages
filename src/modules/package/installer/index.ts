import type { Info, LocatorError } from './locator';
import Downloader from './downloader';

export /*bundle*/ class PackageInstaller {
	/**
	 * Installs a package by its specifier.
	 * @param identifier The package identifier to install, which can be a name, version, or URL.
	 * @returns A promise that resolves to the installed package info.
	 * @throws LocatorError if the package cannot be found or installed.
	 */
	async install(identifier: string): Promise<Info> {
		const downloader = new Downloader(info);
		await downloader.install();
	}

	/**
	 * Uninstalls a package by its specifier.
	 * @param specifier The package specifier to uninstall.
	 * @returns A promise that resolves when the package is uninstalled.
	 */
	async uninstall(identifier: string): Promise<void> {}
}
