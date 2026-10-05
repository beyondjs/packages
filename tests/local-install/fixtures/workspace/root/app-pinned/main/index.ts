import { message } from '@fixture/message/main';

// The declared range is ^1.0.0; the root's override selects the second version for this package
export const text = `pinned: ${message}`;
