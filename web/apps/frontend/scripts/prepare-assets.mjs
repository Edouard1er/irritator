import { copyFile, mkdir } from 'node:fs/promises';
const target = new URL('../public/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL('../node_modules/plotly.js-basic-dist-min/plotly-basic.min.js', import.meta.url), new URL('plotly-basic.min.js', target));
await copyFile(new URL('../node_modules/plotly.js-basic-dist-min/LICENSE', import.meta.url), new URL('LICENSE-plotly', target));
