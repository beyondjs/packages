import type { ICollection } from './collection';

export /*bundle*/ interface IConditionalData {
	package: string; // Unique key for the package, e.g., "react@18.2.0" or "github.com/facebook/react@main"
	module: string; // Module name
	conditional: string; // Conditional name
	hash: string; // Hash of the conditional sources
}

export /*bundle*/ type Conditionals = ICollection<IConditionalData>;
