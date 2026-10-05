// Imports a package it does not declare, which its graph therefore does not provide
import { phantom } from 'phantom';

export const loose = `loose with ${phantom}`;
