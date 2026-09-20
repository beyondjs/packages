import { Compatibility as Keys } from '@beyond-js/packages/analysis';

/**
 * The compatibility key of an output: `sha256-<hex>` over the canonical JSON of its inputs, as
 * `beyond-inventory/1` defines them (`module`, `sources`, `resolution`, `compiler`, `conditions`, `format`,
 * `output`).
 *
 * It is the one implementation analysis uses for the items of an inventory, published here as well because
 * whoever generates and stores outputs looks them up by it. It is distinct from the content digest of an
 * output, and the storage scope is never an input: `key` throws when the inputs carry one.
 */
export /*bundle*/ class Compatibility extends Keys {}
