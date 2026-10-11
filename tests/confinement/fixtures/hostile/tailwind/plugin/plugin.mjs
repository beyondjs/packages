// A Tailwind plugin the package supplies. A confined compilation never runs it. When it runs, it leaves a
// marker where the validation names one and opens a connection to the validation's probe.
import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';

const { BEYOND_CONFINEMENT_MARKER: marker, BEYOND_CONFINEMENT_PORT: port } = process.env;
marker && writeFileSync(`${marker}.plugin`, 'executed');
port && connect(Number(port), '127.0.0.1').on('error', () => {}).end();

export default function plugin() {}
