import type { CompilerOptions } from 'typescript';

// Neither `typescript` nor `@types/node` is a dependency of this package: only the toolchain has them
export const options: CompilerOptions = {};
export const directory: string = process.cwd();
