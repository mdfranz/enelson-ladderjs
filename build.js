import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as rollup from 'rollup';
import rollupJson from '@rollup/plugin-json';
import rollupAlias from '@rollup/plugin-alias';
import rollupTerser from '@rollup/plugin-terser';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import AsepriteCli from './tools/aseprite-cli.js';
import ImageDataParser from './tools/image-data-parser.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------------
// Version
// -----------------------------------------------------------------------------

function generateGameVersion() {
    const data = { GameVersion: require('./package.json').version };
    fs.writeFileSync('src/js/GameVersion-gen.json', JSON.stringify(data, null, 4), 'utf8');
}

// -----------------------------------------------------------------------------
// JS Build
// -----------------------------------------------------------------------------

async function buildJs() {
    generateGameVersion();
    const bundle = await rollup.rollup({
        input: 'src/js/index.js',
        plugins: [rollupJson(), rollupTerser({ mangle: false })],
        onwarn: (warning, warn) => { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning); }
    });
    await bundle.write({ file: 'dist/app.js', format: 'iife', name: 'app' });
}

// -----------------------------------------------------------------------------
// Server Build
// -----------------------------------------------------------------------------

export async function buildServer() {
    generateGameVersion();
    const bundle = await rollup.rollup({
        input: 'src/js/server.js',
        external: ['express', 'ws', 'path', 'http', 'url', 'pino'],
        plugins: [
            rollupAlias({
                entries: [
                    { find: './Viewport', replacement: path.resolve(__dirname, 'src/js/shims/ServerViewport.js') },
                    { find: './Text',     replacement: path.resolve(__dirname, 'src/js/shims/ServerText.js') },
                    { find: './Audio',    replacement: path.resolve(__dirname, 'src/js/shims/ServerAudio.js') },
                    { find: './Sprite',   replacement: path.resolve(__dirname, 'src/js/shims/ServerSprite.js') },
                    { find: './logger.js', replacement: path.resolve(__dirname, 'src/js/shims/ServerLogger.js') }
                ]
            }),
            rollupJson()
        ],
        onwarn: (warning, warn) => { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning); }
    });
    await bundle.write({ file: 'dist/server.js', format: 'esm' });
}

// -----------------------------------------------------------------------------
// CSS Build
// -----------------------------------------------------------------------------

function buildCss() {
    const input = fs.readFileSync('src/app.css', 'utf8');
    const output = new CleanCSS().minify(input).styles;
    fs.writeFileSync('dist/app.css', output, 'utf8');
}

// -----------------------------------------------------------------------------
// Assets Build
// -----------------------------------------------------------------------------

async function exportSpriteSheet() {
    const src  = 'src/assets/*.aseprite';
    const png  = 'src/assets/spritesheet-gen.png';
    const data = 'src/assets/spritesheet-gen.json';
    try {
        const r = AsepriteCli.exec(`--batch ${src} --sheet-type packed --sheet ${png} --data ${data} --format json-array`);
        console.log(r);
    } catch (e) {
        console.error(e);
        console.warn('Failed to update sprite sheet, but building anyway...');
    }
}

async function generateSpriteSheetData() {
    await ImageDataParser.parse('src/assets/spritesheet-gen.json', 'sprites.png', false, 'src/js/SpriteSheet-gen.js');
}

function copyAssets() {
    fs.copyFileSync('src/assets/spritesheet-gen.png', 'dist/sprites.png');
}

async function buildAssets() {
    await exportSpriteSheet();
    copyAssets();
    await generateSpriteSheetData();
}

// -----------------------------------------------------------------------------
// HTML Build
// -----------------------------------------------------------------------------

async function buildHtml() {
    const input = fs.readFileSync('src/index.html', 'utf8');
    const output = await minifyHtml(input, { collapseWhitespace: true });
    fs.writeFileSync('dist/index.html', output, 'utf8');
}

// -----------------------------------------------------------------------------
// Build / Watch
// -----------------------------------------------------------------------------

async function build() {
    await buildAssets();
    await buildJs();
    buildCss();
    await buildHtml();
    await buildServer();
}

function watch() {
    let timer;
    fs.watch('src', { recursive: true }, (event, filename) => {
        if (filename?.includes('-gen')) return;
        clearTimeout(timer);
        timer = setTimeout(() => build().catch(console.error), 100);
    });
}

const [,, command] = process.argv;

if (command === 'server') {
    buildServer().catch(console.error);
} else if (command === 'watch') {
    build().then(() => watch()).catch(console.error);
} else {
    build().catch(console.error);
}
