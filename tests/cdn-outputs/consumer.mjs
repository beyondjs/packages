/**
 * The process that executes generated ES modules. BEE Node resolves bare specifiers through the import map
 * named by `BEE_IMPORT_MAP`, so every public module is one file and every reference stays bare. The
 * scenario to run is the first argument; its result is printed as one JSON line.
 */
const scenarios = {
	async fixture() {
		const app = await import('@fixture/app/main');
		const react = await import('fake-react');
		const renderer = await import('fake-react-dom');
		const lazy = await app.chart();
		return {
			view: app.view(), chart: lazy.chart(), mode: react.mode, named: typeof react.useState,
			shared: renderer.react === react.default, defaulted: react.default.createElement === react.createElement
		};
	},

	async react() {
		const React = await import('react');
		const { jsx } = await import('react/jsx-runtime');
		const server = await import('react-dom/server');
		const dom = await import('react-dom');
		const client = await import('react-dom/client');

		const App = ({ name }) => {
			const [count] = React.useState(41);
			const id = React.useId();
			return jsx('p', { id, children: `${name}:${count + 1}` });
		};
		return {
			html: server.renderToString(jsx(App, { name: 'shared' })),
			version: React.version, dom: dom.version, root: typeof client.createRoot, named: typeof React.useState,
			defaulted: React.default.useState === React.useState
		};
	}
};

const result = await scenarios[process.argv[2]]();
console.log(`RESULT ${JSON.stringify(result)}`);
