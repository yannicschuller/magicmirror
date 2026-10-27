import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// package version plus build id, e.g. "1.1.0+3f2a9c1" – changes with every image.
export const VERSION = process.env.MM_VERSION && process.env.MM_VERSION !== 'dev' ? `${pkg.version}+${process.env.MM_VERSION}` : `${pkg.version}+dev`;
