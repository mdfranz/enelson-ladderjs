// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------
import advpng            from 'imagemin-advpng';
import chalk             from 'chalk';
import fs                from 'node:fs';
import gulp              from 'gulp';
import log               from 'fancy-log';
import * as rollup       from 'rollup';
import rollupJson        from '@rollup/plugin-json';
import rollupAlias       from '@rollup/plugin-alias';
import path              from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import AsepriteCli       from './tools/aseprite-cli.js';
import ImageDataParser   from './tools/image-data-parser.js';

// -----------------------------------------------------------------------------
// Gulp Plugins
// -----------------------------------------------------------------------------
import concat            from 'gulp-concat';
import cleancss          from 'gulp-clean-css';
import htmlmin           from 'gulp-htmlmin';
import imagemin          from 'gulp-imagemin';
import rename            from 'gulp-rename';
import sourcemaps        from 'gulp-sourcemaps';
import template          from 'gulp-template';
import terser            from 'gulp-terser';

// -----------------------------------------------------------------------------
// JS Build
// -----------------------------------------------------------------------------
async function generateGameVersion() {
    let file = 'src/js/GameVersion-gen.json';
    let data = {
        GameVersion: require('./package.json').version
    };
    fs.writeFileSync(file, JSON.stringify(data, undefined, 4), 'utf8');
}

async function compileBuild(opts = {}) {
    try {
        const bundle = await rollup.rollup({
            input: 'src/js/index.js',
            plugins: [rollupJson()],
            onwarn: (warning, rollupWarn) => {
                // Suppress circular dependency warnings
                if (warning.code !== 'CIRCULAR_DEPENDENCY') {
                    rollupWarn(warning);
                }
            }
        });

        await bundle.write({
            file: 'temp/app.js',
            format: 'iife',
            name: 'app',
            sourcemap: opts.sourcemap ? 'inline' : false
        });
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function compileBuildDebug() {
    return compileBuild({ sourcemap: true });
}

function compileBuildProd() {
    return compileBuild({ sourcemap: false });
}

function minifyBuild(opts = {}) {
    let stream = gulp.src('temp/app.js', { encoding: false });
    if (opts.sourcemap) {
        stream = stream.pipe(sourcemaps.init({ loadMaps: true }));
    }
    stream = stream.pipe(terser({
        mangle: false
    }));
    if (opts.sourcemap) {
        stream = stream.pipe(sourcemaps.write('.'));
    }
    return stream.pipe(gulp.dest('dist'));
}

function minifyBuildDebug() {
    return minifyBuild({ sourcemap: true });
}

function minifyBuildProd() {
    return minifyBuild({ sourcemap: false });
}

export const buildJs = gulp.series(generateGameVersion, compileBuildProd, minifyBuildProd);
export const buildJsDebug = gulp.series(generateGameVersion, compileBuildDebug, minifyBuildDebug);

// -----------------------------------------------------------------------------
// Server Build
// -----------------------------------------------------------------------------
export async function compileServerBuild() {
    try {
        const bundle = await rollup.rollup({
            input: 'src/js/server.js',
            external: ['express', 'ws', 'path', 'http', 'url', 'pino'],
            plugins: [
                rollupAlias({
                    entries: [
                        { find: './Viewport', replacement: path.resolve(__dirname, 'src/js/shims/ServerViewport.js') },
                        { find: './Text', replacement: path.resolve(__dirname, 'src/js/shims/ServerText.js') },
                        { find: './Audio', replacement: path.resolve(__dirname, 'src/js/shims/ServerAudio.js') },
                        { find: './Sprite', replacement: path.resolve(__dirname, 'src/js/shims/ServerSprite.js') },
                        { find: './logger.js', replacement: path.resolve(__dirname, 'src/js/shims/ServerLogger.js') }
                    ]
                }),
                rollupJson()
            ],
            onwarn: (warning, rollupWarn) => {
                if (warning.code !== 'CIRCULAR_DEPENDENCY') {
                    rollupWarn(warning);
                }
            }
        });

        await bundle.write({
            file: 'dist/server.js',
            format: 'esm'
        });
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export const buildServer = gulp.series(generateGameVersion, compileServerBuild);

// -----------------------------------------------------------------------------
// CSS Build
// -----------------------------------------------------------------------------
export function buildCss() {
    return gulp.src('src/app.css', { encoding: false })
        .pipe(cleancss())
        .pipe(gulp.dest('dist'));
}

// -----------------------------------------------------------------------------
// Assets Build
// -----------------------------------------------------------------------------

export async function exportSpriteSheet() {
    let src = 'src/assets/*.aseprite';
    let png = 'src/assets/spritesheet-gen.png';
    let data = 'src/assets/spritesheet-gen.json';

    try {
        let r = await AsepriteCli.exec(`--batch ${src} --sheet-type packed --sheet ${png} --data ${data} --format json-array`);
        log.info(r);
    } catch (e) {
        log.error(e);
        log.warn(chalk.red('Failed to update sprite sheet, but building anyway...'));
    }
}

export async function generateSpriteSheetData() {
    let data = 'src/assets/spritesheet-gen.json';
    let image = 'sprites.png';
    let output = 'src/js/SpriteSheet-gen.js';

    await ImageDataParser.parse(data, image, false, output);
}

export function copyAssets() {
    return gulp.src('src/assets/spritesheet-gen.png', { encoding: false })
        .pipe(rename('sprites.png'))
        .pipe(gulp.dest('dist'));
}

export const buildAssets = gulp.series(
    exportSpriteSheet,
    copyAssets,
    generateSpriteSheetData,
);

// -----------------------------------------------------------------------------
// HTML Build
// -----------------------------------------------------------------------------
export function buildHtml() {
    return gulp.src('src/index.html', { encoding: false })
        .pipe(htmlmin({ collapseWhitespace: true }))
        .pipe(gulp.dest('dist'));
}

// -----------------------------------------------------------------------------
// Build
// -----------------------------------------------------------------------------
export const build = gulp.series(
    buildAssets,
    buildJs,
    buildCss,
    buildHtml,
    buildServer
);

// -----------------------------------------------------------------------------
// Watch
// -----------------------------------------------------------------------------
export function watch() {
    gulp.watch(['src/**', '!src/**/*-gen*'], build);
}

// -----------------------------------------------------------------------------
// Task List
// -----------------------------------------------------------------------------
export default gulp.series(build, watch);
