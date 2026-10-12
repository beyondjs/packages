/**
 * The badge of the page: an image of a declared asset, addressed from the module, styled by the module's stylesheet
 */
import './badge.css';
import logo from './logo.svg';

const image = document.createElement('img');
image.className = 'badge';
image.alt = 'Badge';
image.src = logo;
image.addEventListener('load', () => (document.body.dataset.badge = 'loaded'));
document.body.append(image);
