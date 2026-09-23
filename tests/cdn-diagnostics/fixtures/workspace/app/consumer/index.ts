import { greet, type Greeting } from '@fixture/shared/message';

export const hello: Greeting = greet('world');
export const text: string = hello.text;
