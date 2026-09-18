/**
 * Containment of a defect of the installed `@beyond-js/dynamic-processor` (1.0.8) that would otherwise end a
 * long-lived service. It is recognized by its exact failure and logged; any other uncaught exception ends
 * the service, stopping what it started.
 *
 * When a processor takes longer than five seconds, the utility means to print a warning. Its checkpoint
 * calls `append` on the namespace of the logger module instead of on its default export, so the warning
 * throws from a timer. A slow processor is an ordinary event in a development service (a large workspace, a
 * busy machine). The source of the utility is repaired; this stays until Packages depends on a published
 * version that contains the repair.
 *
 * The warning text never reaches the logger, so with `BEYOND_TRACE_PROCESSORS=1` it is captured where the
 * utility builds it: it colours the message through the `red` accessor that the `colors` package defines on
 * strings.
 */
export class Processors {
	static #known = [
		{
			matches: error => error instanceof TypeError && /logs\.append is not a function/.test(error.message),
			message: 'a processor is taking longer than expected (its warning could not be printed)'
		}
	];

	/**
	 * @param {(message: string) => void} log
	 * @param {() => boolean} ending Whether the service is already stopping, when a failure of something
	 * being torn down is logged and does not change how the service ends
	 * @param {(reason: string) => void} fail Ends the service after an unknown failure, stopping what it
	 * started instead of abandoning it
	 */
	static contain(log, ending, fail) {
		process.on('uncaughtException', error => {
			const known = Processors.#known.find(({ matches }) => matches(error));
			if (known) return log(known.message);
			if (ending()) return log(`while stopping: ${error.message}`);

			log(`uncaught: ${error.stack}`);
			fail(`uncaught exception: ${error.message}`);
		});

		if (!process.env.BEYOND_TRACE_PROCESSORS) return;
		const accessor = Object.getOwnPropertyDescriptor(String.prototype, 'red');
		Object.defineProperty(String.prototype, 'red', {
			configurable: true,
			get() {
				/Dynamic processor/.test(this) && log(`processor warning: ${this}`);
				return accessor?.get ? accessor.get.call(this) : String(this);
			}
		});
	}
}
