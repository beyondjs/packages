const ModuleBundler = require('../base');

module.exports = class extends ModuleBundler {
	get dp() {
		return 'module.conditional.bundler.js';
	}
};
