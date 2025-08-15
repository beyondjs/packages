const { header } = require('@beyond-js/code');

module.exports = function (bundle) {
	const { container } = bundle;
	return header(container.is === 'library' ? `LIBRARY: ${container.name}` : `MODULE: ${container.specifier}`);
};
