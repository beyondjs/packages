import { message } from '@fixture/message/main';

// Its declaration imports the member it depends on, which its dependents do not depend on themselves
export const wrapped: typeof message = message;
