import type { ConditionalProcessor } from '../../processor';

/**
 * The class ConditionalProcessor is abstract, so we need a constructor type that can be reused by subclasses.
 * Since subclasses should not expose the last constructor argument (strategy), we remove it using a helper type.
 **/
// Utility type to omit the last element of a tuple
type OmitLast<T extends any[]> = T extends [...infer Rest, any] ? Rest : never;
// Extract constructor parameters of ConditionalProcessor
type ProcessorCtorArgs = ConstructorParameters<typeof ConditionalProcessor>;
// Constructor arguments without 'strategy' parameter
type ProcessorCtorArgsWithoutStrategy = OmitLast<ProcessorCtorArgs>;
// Constructor signature for subclasses of ConditionalProcessor
export type ProcessorConstructor = new (...args: ProcessorCtorArgsWithoutStrategy) => ConditionalProcessor;
