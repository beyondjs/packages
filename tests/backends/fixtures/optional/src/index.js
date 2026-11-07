// Optional packages, required where they are used and guarded as `debug` guards `supports-color`
const codes = [];
for (const load of [() => require('absent-peer'), () => require('absent-optional/sub')]) {
	try {
		load();
		codes.push('loaded');
	} catch (error) {
		codes.push(error.code);
	}
}
exports.codes = codes;
