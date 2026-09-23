export interface Greeting {
	text: string;
}

export function greet(subject: string): Greeting {
	return { text: `Hello, ${subject}` };
}

export const greetings: Greeting[] = [greet('world')];
