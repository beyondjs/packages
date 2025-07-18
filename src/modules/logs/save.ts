import { mkdir, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'logs');

export async function save(data: object, id = 'default'): Promise<void> {
	const dir = root;
	const path = join(dir, `${id}.log`);

	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}

	const line = JSON.stringify(data) + '\n';
	await appendFile(path, line, 'utf8');
}
