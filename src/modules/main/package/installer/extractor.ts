import tar from 'tar-stream';
import * as zlib from 'zlib';
import { PackageFile } from '../storage/PackageFile';
import type { IFileStorage } from '@beyond-js/packages/storage/interfaces';

interface IFile {
	path: string;
	size: number;
	mtime: number;
	type: string;
}

export async function extract(storage: IFileStorage, root: string, tarball: NodeJS.ReadableStream): Promise<IFile[]> {
	return new Promise((resolve, reject) => {
		const files: any[] = [];
		const extract = tar.extract();

		extract.on('entry', (header, reader, next) => {
			const split = header.name.split('/');
			if (split[0] === 'package') split.shift();
			const path = split.join('/');

			const { size, mtime, type } = header;
			files.push({ path, size, mtime: mtime, type });

			const target = `${root}/${path}`;
			const file = new PackageFile(storage, target);

			file.createWriteStream().then(writer => {
				writer.on('error', err => reject(err));
				writer.on('finish', next);
				reader.pipe(writer);
				reader.resume();
			});
		});

		extract.on('finish', () => resolve(files));
		extract.on('error', err => reject(err));

		const gunzip = zlib.createGunzip();
		gunzip.on('error', err => reject(err));

		tarball.pipe(gunzip).pipe(extract);
	});
}
