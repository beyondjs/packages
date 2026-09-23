'use strict';
var ReactDOM = require('fake-react-dom');
exports.createRoot = function () { return { render: ReactDOM.render }; };
exports.dom = ReactDOM;
