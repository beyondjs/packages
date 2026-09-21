import type { Badge } from '@fixture/ui/badge';
import { title } from './title';

export const card = (badge: Badge): string => `${title('Card')} ${badge.label}`;
export const count = 1;
