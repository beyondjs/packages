'use strict';
var internals = { dispatcher: null };
exports.__internals = internals;
exports.mode = 'production';
exports.version = '18.0.0';
exports.createElement = function (type, props) { return { type: type, props: props || {} }; };
exports.useState = function (initial) {
  if (!internals.dispatcher) throw new Error('Invalid hook call: the renderer uses another copy of fake-react');
  return internals.dispatcher.useState(initial);
};
