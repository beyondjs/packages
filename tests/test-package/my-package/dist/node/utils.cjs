const react = require('react');

const name = 'henry';

function hello() {
	return `hello ${name}`;
}

function bye() {
	return `goodbye ${name}`;
}

function message() {
	return hello() + ' and ' + bye();
}

exports.hello = hello;
exports.bye = bye;
exports.message = message;

const element = react.createElement('div', null, 'This is a react element');
exports.element = element;
