import { IFileStorage } from './IFileStorage';

export class PackageFile {
	constructor(private storage: IFileStorage, private target: string) {}

	async createWriteStream(): Promise<NodeJS.WritableStream> {
		return this.storage.createWriteStream(this.target);
	}
}
