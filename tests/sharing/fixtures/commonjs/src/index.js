const state = require('./state.js');
exports.use = () => state.bump();
exports.value = () => state.store.value;
