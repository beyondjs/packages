// The page imports a module of a library installed from a registry, which is composed on the same runtime
import { greeting } from '@sources/lib/greeting';

export const page = greeting('world');
