/**
 * Stands for the BEE Node registration (`node --import <register>`): it registers no loader, and leaves the origin it
 * would load modules from where the stand-in launcher reports it, so a case can tell that the registration ran first,
 * with the loader configuration of the launch.
 */
globalThis.STAND_IN_REGISTERED = { url: process.env.BEE_URL, adapter: process.env.BEE_ADAPTER };
