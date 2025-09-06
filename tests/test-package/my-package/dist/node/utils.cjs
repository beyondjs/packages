const react = require('react');

const name = 'henry';

exports.hello = async function () {
	return `hello ${name}`;
};

function bye() {
	return `goodbye ${name}`;
}

function message() {
	return hello() + ' and ' + bye();
}

exports.bye = bye;
exports.message = message;

const element = react.createElement('div', null, 'This is a react element');
exports.element = element;
