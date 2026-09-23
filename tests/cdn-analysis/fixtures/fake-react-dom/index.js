'use strict';
var React = require('fake-react');
exports.react = React;
exports.render = function (element) {
  React.__internals.dispatcher = { useState: function (initial) { return 'state:' + initial; } };
  try { return element.type(element.props); } finally { React.__internals.dispatcher = null; }
};
