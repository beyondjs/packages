import type { DynamicFile } from '@beyond-js/file/dynamic';
import { CompiledArtifact } from './artifact';

export class CompiledArtifacts extends Map<string, CompiledArtifact> {
	obtain(file: DynamicFile): CompiledArtifact {
		if (this.has(file.relative.file)) {
			return super.get(file.relative.file);
		}

		const artifact = new CompiledArtifact(file);
		super.set(file.relative.file, artifact);
		return artifact;
	}

	update(artifact: CompiledArtifact): void {
		if (!(artifact instanceof CompiledArtifact)) {
			throw new Error(`Invalid artifact, expected an instance of CompiledArtifact`);
		}

		super.set(artifact.file.relative.file, artifact);
	}
}
