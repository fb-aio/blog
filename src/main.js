import { html, render } from './runtime.js';
import App from './app/App.js';

render(html`<${App} />`, document.getElementById('root'));
