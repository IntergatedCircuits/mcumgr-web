import { mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const shared = {
    entryPoints: ['js/library.mjs'],
    bundle: true,
    sourcemap: true,
    logLevel: 'info'
};

await build({
    ...shared,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    outfile: 'dist/index.mjs'
});

await build({
    ...shared,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    outfile: 'dist/index.cjs'
});

await build({
    ...shared,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    globalName: 'Mcumgr',
    outfile: 'dist/index.iife.js'
});