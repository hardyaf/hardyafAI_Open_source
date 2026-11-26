import { mkdir, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'dist');
if(relative(root, output) !== 'dist') throw new Error('unsafe_output');
await mkdir(output, {recursive:true});
// Only generated allowlisted assets are replaced. This is a static client, with no server or secrets.
for(const asset of ['index.html','styles.css','app.mjs','signing.mjs']) {
  await rm(resolve(output, asset), {force:true});
  await copyFile(resolve(root,'src',asset), resolve(output,asset));
}
console.log('Kitchen display assets ready in dist/');
