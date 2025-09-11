const BEE = require('@beyond-js/bee');

BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { db } = await bimport('@beyond-js/packages/persistence/db');
	await db.init();

	// Get the conditional data
	const id = `react@18.2.0:.:development`;
	const initial = await db.conditionals.get({ id });
	console.log(`1. Initial conditional data "${id}":`, initial);

	// Store the conditional data
	console.log(`2. Storing conditional data "${id}".`);
	const data = { hello: 'world' };
	await db.conditionals.set({ id, data }).catch(exc => console.error(exc.stack));

	// Retrieve the stored conditional data
	const stored = await db.conditionals.get({ id });
	console.log(`3. Stored conditional data "${id}":\n`, stored);

	// Delete the conditional data
	console.log(`4. Deleting conditional data "${id}"`);
	await db.conditionals.delete({ id }).catch(exc => console.error(exc.stack));

	// Try to retrieve the deleted conditional data
	const deleted = await db.conditionals.get({ id });
	console.log(`5. Is conditional data "${id}" deleted?:`, deleted === void 0);
})();
