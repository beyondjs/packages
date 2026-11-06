import * as React from 'react';
import { createRoot } from 'react-dom/client';

function Counter() {
	const [count, setCount] = React.useState(0);
	return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}

const container = document.createElement('div');
document.body.append(container);
createRoot(container).render(<Counter />);
