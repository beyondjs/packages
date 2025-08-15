const Extension = require('./extension');

module.exports = class extends Map {
	constructor(preprocessor, extending) {
		super();

		/**
		 * Each name corresponds to a processor that is being extended and added to this Map.
		 */
		extending.forEach(name => {
			const extension = new Extension(name, preprocessor);
			this.set(name, extension);
		});
	}
};
