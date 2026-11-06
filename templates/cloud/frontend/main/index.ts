const main = document.createElement('main');

const title = document.createElement('h1');
title.textContent = 'Hello from Beyond';

const text = document.createElement('p');
text.textContent = 'Written in the cloud and delivered by Beyond CDN.';

main.append(title, text);
document.body.append(main);
