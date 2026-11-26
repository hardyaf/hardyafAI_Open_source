import { copyFile, mkdir } from 'node:fs/promises';

const output = new URL('./dist/', import.meta.url);
await mkdir(output, { recursive: true });
for (const asset of ['index.html', 'styles.css', 'app.mjs', 'api.mjs', 'library.mjs', 'media.mjs', 'workspace.mjs', 'fitbit.mjs', 'connections.mjs', 'connections.css', 'sidebar.mjs']) {
  await copyFile(new URL('./src/' + asset, import.meta.url), new URL(asset, output));
}
await copyFile(new URL('../kitchen-display/src/signing.mjs', import.meta.url), new URL('signing.mjs', output));
console.log('Hardy Home browser assets ready in dist/');
