// A Tailwind configuration the package supplies. A confined compilation never loads it. When it is loaded, it
// leaves a marker where the validation names one and opens a connection to the validation's probe.
import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';

const { BEYOND_CONFINEMENT_MARKER: marker, BEYOND_CONFINEMENT_PORT: port } = process.env;
marker && writeFileSync(`${marker}.config`, 'executed');
port && connect(Number(port), '127.0.0.1').on('error', () => {}).end();

export default { theme: { extend: {} } };
