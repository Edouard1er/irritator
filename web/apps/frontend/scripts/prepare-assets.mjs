import { copyFile, mkdir } from 'node:fs/promises';
const target = new URL('../public/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL('../node_modules/plotly.js-basic-dist-min/plotly-basic.min.js', import.meta.url), new URL('plotly-basic.min.js', target));
await copyFile(new URL('../node_modules/plotly.js-basic-dist-min/LICENSE', import.meta.url), new URL('LICENSE-plotly', target));
const geography = new URL('../public/geography/', import.meta.url);
await mkdir(geography, { recursive: true });
await copyFile(new URL('../data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url),
  new URL('lac-de-guiers.hydrolakes.geojson', geography));
