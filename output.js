
import __ns_react from 'react';

function require(id) {
  switch (id) {
    case 'react': return __ns_react;
    default: throw new Error("require: " + id + " not supported");
  }
}

const module = { exports: {} };
const exports = module.exports;

// beyondjs-bundler:/Users/henry/Documents/@beyond-js/packages/tests/test-package/my-package/dist/node/utils.cjs
var react = require("react");
var name = "henry";
function hello() {
  return `hello ${name}`;
}
function bye() {
  return `goodbye ${name}`;
}
function message() {
  return hello() + " and " + bye();
}
exports.hello = hello;
exports.bye = bye;
exports.message = message;
var element = react.createElement("div", null, "This is a react element");
exports.element = element;

const __exp = module.exports;
export default __exp;
export const hello = __exp.hello;
export const bye = __exp.bye;
export const message = __exp.message;
export const element = __exp.element;