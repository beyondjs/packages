import { Widget } from '@fixture/ui/widget';
import '@fixture/ui/theme.css';
import { createElement, useState } from 'fake-react';
import { render } from 'fake-react-dom';
export const marker: string = 'APP_MAIN_SOURCE_MARKER';
export const chart = () => import('@fixture/ui/chart');
export const plugin = (name: string) => import('@fixture/plugins/' + name);
export const view = () => render(createElement(() => useState(Widget.label)));
