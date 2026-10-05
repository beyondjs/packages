import { greet } from 'greeting';

// Another package needs an edge, which a package the graph does not have has none of
export const greeted: string = greet('unlisted');
