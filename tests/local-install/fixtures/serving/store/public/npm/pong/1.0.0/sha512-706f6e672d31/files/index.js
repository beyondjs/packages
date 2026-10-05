// The two packages import each other: walking them must end
import * as other from 'ping';

export const pong = () => `pong beside ${typeof other.ping}`;
