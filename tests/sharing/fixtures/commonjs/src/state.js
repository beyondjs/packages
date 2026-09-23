const store = { value: 0 };
exports.store = store;
exports.bump = () => ++store.value;
