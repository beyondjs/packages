/**
 * A stand-in for the supervisor that `Service` starts, given to it as `Service.SUPERVISOR`: it reports at once a
 * ready record that names an address where nothing answers, so the start fails as a service that did not describe
 * itself, and it ends as soon as its launcher disconnects, which the launcher does once it knows the outcome. It
 * ends after ten seconds whatever happens, so a case never leaves it behind.
 */
process.on('disconnect', () => process.exit(0));
setTimeout(() => process.exit(0), 10000);
process.send({ ready: { pid: process.pid, origin: 'http://127.0.0.1:1', log: 'departing.log' } });
