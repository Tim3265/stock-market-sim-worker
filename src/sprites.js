// ============================================================
//  PIXEL SPRITES v2 — 16x16, single-letter palette keys
//  Taiwan stock convention: RED = up, GREEN = down
// ============================================================

export const SPRITE_PALETTE = {
  '.': null,        // transparent
  'K': '#14162b',   // near-black outline
  'k': '#3a3f5c',   // dark secondary outline
  'w': '#f4f7ff',   // white highlight
  'g': '#8a90b8',   // mid gray
  'G': '#c8d0e8',   // light silver
  'Y': '#ffd23f',   // gold / yellow
  'y': '#c8951a',   // dark gold
  'O': '#ff9f2e',   // orange
  'o': '#d2691e',   // dark orange
  'R': '#ff5470',   // red (Taiwan UP)
  'r': '#c22434',   // dark red
  'E': '#3ddc78',   // green (Taiwan DOWN)
  'e': '#1d9e52',   // dark green
  'B': '#4db2ff',   // bright blue
  'b': '#1e5aa8',   // mid blue
  'D': '#2b3a67',   // navy
  'd': '#16204a',   // dark navy
  'C': '#4dd0e1',   // cyan
  'P': '#b388ff',   // purple
  'M': '#ff8a65',   // salmon
};

// ------------------------------------------------------------
//  BASE SPRITES (frame 0 of each animation)
// ------------------------------------------------------------
export const SPRITES = {

  // ---- 2330 台積電 "GG" — semiconductor chip ----
  '2330': {
    palette: { K:'#14162b', D:'#2b3a67', G:'#c8d0e8', Y:'#ffd23f', w:'#f4f7ff' },
    rows: [
      '................',  // 0
      '....KKKKKKKK....',  // 1
      '..KKDDDDDDDDKK..',  // 2
      '.KYDDDDDDDDDDYK.',  // 3
      'KYKDDKKKKKKDDKYK',  // 4
      'KYKDDKGGGGKDDKYK',  // 5
      'KYKDDKGGGGKDDKYK',  // 6
      'KYKDDKGGGGKDDKYK',  // 7
      'KYKDDKGGGGKDDKYK',  // 8
      'KYKDDKKKKKKDDKYK',  // 9
      '.KYDDDDDDDDDDYK.',  // 10
      '..KKDDDDDDDDKK..',  // 11
      '....KKKKKKKK....',  // 12
      '................',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },

  // ---- 2317 鴻海 "紅海" — red ocean waves with white foam ----
  '2317': {
    palette: { R:'#ff5470', r:'#c22434', w:'#f4f7ff' },
    rows: [
      '................',  // 0
      '................',  // 1
      '................',  // 2
      '................',  // 3
      '................',  // 4
      '..RRR...RRR.....',  // 5  wave crest 1
      '.RwRRR.RwRRR....',  // 6  foam
      'RRRRRRRRRRRRRR..',  // 7  wave body
      '.rrrrrrrrrrrr...',  // 8  shadow
      '..RRR...RRR.....',  // 9  wave crest 2
      '.RwRRR.RwRRR....',  // 10 foam
      'RRRRRRRRRRRRRR..',  // 11 wave body
      '.rrrrrrrrrrrr...',  // 12 shadow
      '................',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },

  // ---- 2454 聯發科 "發哥" — lightning bolt ----
  '2454': {
    palette: { Y:'#ffd23f', y:'#c8951a', w:'#f4f7ff', K:'#14162b' },
    rows: [
      '................',  // 0
      '......YYYK......',  // 1
      '.....YYYK.......',  // 2
      '....YYYK........',  // 3
      '...YYYYK........',  // 4
      '..YYYYYYYK......',  // 5  bolt mid
      '....YYYK........',  // 6
      '...YYYK.........',  // 7
      '..YYYK..........',  // 8
      '.YYYK...........',  // 9
      'YYYK............',  // 10
      '.YYK............',  // 11
      '................',  // 12
      '................',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },

  // ---- 3711 日月光投控 "日月潭" — sun + moon over water ----
  '3711': {
    palette: { O:'#ff9f2e', Y:'#ffd23f', m:'#c8d0e8', w:'#f4f7ff', b:'#1e5aa8', B:'#4db2ff', K:'#14162b' },
    rows: [
      '................',  // 0
      '...O.O....mm....',  // 1  sun ray + moon top
      '..OYYYO..mwwm...',  // 2
      '.OYYYYYOm.mwwm..',  // 3
      '..OYYYO..mmmm...',  // 4
      '...O.O....mm....',  // 5
      '................',  // 6
      '................',  // 7
      '..bb..bb..bb....',  // 8  water
      'bbbbbbbbbbbbbb..',  // 9
      '.bb..bb..bb..bb.',  // 10
      'bbbbbbbbbbbbbb..',  // 11
      '.bb..bb..bb..bb.',  // 12
      '................',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },

  // ---- YZU 元智大學 "元智AI" — dolphin mascot jumping ----
  'YZU': {
    palette: { B:'#4db2ff', b:'#1e5aa8', w:'#f4f7ff', K:'#14162b' },
    rows: [
      '................',  // 0
      '................',  // 1
      '..........BB....',  // 2  snout
      '........BBwB....',  // 3  head + eye
      '......BBBBBB....',  // 4
      '....BBBBBB......',  // 5  body arc
      '..BBBBBB........',  // 6
      '.BBBB....BB.....',  // 7  tail start
      'BBB....BB.......',  // 8
      '.BB...BB........',  // 9
      '..BB.BB.........',  // 10 tail fluke
      '...BB...........',  // 11
      '................',  // 12
      '................',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },

  // ---- YOUJIAN 右鍵 — computer mouse ----
  'YOUJIAN': {
    palette: { K:'#14162b', g:'#8a90b8', G:'#c8d0e8', w:'#f4f7ff', R:'#ff5470' },
    rows: [
      '................',  // 0
      '................',  // 1
      '....KKKKKK......',  // 2
      '..KKGGGGGGKK....',  // 3
      '.KGGGGGGGGGGK...',  // 4
      'KGGGGKGGGGGGGK..',  // 5  button split line
      'KGGGGKwwKGGGGK..',  // 6  scroll wheel
      'KGGGGKKKKGGGGK..',  // 7
      'KGGGGGGGGGGGGK..',  // 8
      'KGGGGGGGGGGGGK..',  // 9
      'KGGGGGGGGGGGGK..',  // 10
      '.KGGGGGGGGGGK...',  // 11
      '..KKGGGGGGKK....',  // 12
      '....KKKKKK......',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },

  // ---- COIN — gold coin for login screen ----
  'COIN': {
    palette: { K:'#14162b', Y:'#ffd23f', y:'#c8951a', w:'#f4f7ff' },
    rows: [
      '................',  // 0
      '................',  // 1
      '....KKKKKK......',  // 2
      '..KYYYYYYYK.....',  // 3
      '.KYYKYYKYYYK....',  // 4  $ top
      'KYYKYYKKYYYK....',  // 5
      'KYYKYYYYYYYK....',  // 6  $ mid bar
      'KYYKKYYKKYYK....',  // 7
      'KYYKYYYYYYYK....',  // 8
      'KYYKYYKKYYYK....',  // 9
      '.KYYKYYKYYYK....',  // 10 $ bottom
      '..KYYYYYYYK.....',  // 11
      '....KKKKKK......',  // 12
      '................',  // 13
      '................',  // 14
      '................',  // 15
    ],
  },
};

// ------------------------------------------------------------
//  ANIMATION FRAMES — 2-4 frames per icon for CSS steps()
//  Each frame is a full 16x16 rows array (same palette as base)
// ------------------------------------------------------------
export const SPRITE_FRAMES = {

  // 2330 chip: circuit pulse — inner die glows white then back
  '2330': [
    SPRITES['2330'].rows,  // frame 0: normal
    [ // frame 1: die glows
      '................',
      '....KKKKKKKK....',
      '..KKDDDDDDDDKK..',
      '.KYDDDDDDDDDDYK.',
      'KYKDDKKKKKKDDKYK',
      'KYKDDKwwwwKDDKYK',
      'KYKDDKwwwwKDDKYK',
      'KYKDDKwwwwKDDKYK',
      'KYKDDKwwwwKDDKYK',
      'KYKDDKKKKKKDDKYK',
      '.KYDDDDDDDDDDYK.',
      '..KKDDDDDDDDKK..',
      '....KKKKKKKK....',
      '................',
      '................',
      '................',
    ],
    [ // frame 2: pins glow gold→white
      '................',
      '....KKKKKKKK....',
      '..KKDDDDDDDDKK..',
      '.KYDDDDDDDDDDYK.',
      'wYKDDKKKKKKDDKYw',
      'wYKDDKGGGGKDDKYw',
      'wYKDDKGGGGKDDKYw',
      'wYKDDKGGGGKDDKYw',
      'wYKDDKGGGGKDDKYw',
      'wYKDDKKKKKKDDKYw',
      '.KYDDDDDDDDDDYK.',
      '..KKDDDDDDDDKK..',
      '....KKKKKKKK....',
      '................',
      '................',
      '................',
    ],
  ],

  // 2317 waves: crest shifts right (wave motion)
  '2317': [
    SPRITES['2317'].rows,  // frame 0
    [ // frame 1: waves shift right by 1px
      '................',
      '................',
      '................',
      '................',
      '................',
      '...RRR...RRR....',
      '..RwRRR.RwRRR...',
      '.RRRRRRRRRRRRRR.',
      '..rrrrrrrrrrrr..',
      '...RRR...RRR....',
      '..RwRRR.RwRRR...',
      '.RRRRRRRRRRRRRR.',
      '..rrrrrrrrrrrr..',
      '................',
      '................',
      '................',
    ],
    [ // frame 2: back to left (oscillation)
      '................',
      '................',
      '................',
      '................',
      '................',
      '.RRR...RRR......',
      'RwRRR.RwRRR.....',
      'RRRRRRRRRRRRR...',
      'rrrrrrrrrrrr....',
      '.RRR...RRR......',
      'RwRRR.RwRRR.....',
      'RRRRRRRRRRRRR...',
      'rrrrrrrrrrrr....',
      '................',
      '................',
      '................',
    ],
  ],

  // 2454 bolt: flicker — highlight sweeps down the bolt
  '2454': [
    SPRITES['2454'].rows,  // frame 0
    [ // frame 1: top half bright
      '................',
      '......YYwK......',
      '.....YYwYK......',
      '....YYwYK.......',
      '...YYYwYK.......',
      '..YYwYYYYK......',
      '....YYYK........',
      '...YYYK.........',
      '..YYYK..........',
      '.YYYK...........',
      'YYYK............',
      '.YYK............',
      '................',
      '................',
      '................',
      '................',
    ],
    [ // frame 2: bottom half bright
      '................',
      '......YYYK......',
      '.....YYYK.......',
      '....YYYK........',
      '...YYYYK........',
      '..YYYYYYYK......',
      '....YYwK........',
      '...YYwK.........',
      '..YYwK..........',
      '.YYwK...........',
      'YYwK............',
      '.YwK............',
      '................',
      '................',
      '................',
      '................',
    ],
  ],

  // 3711 sun/moon: sun rays pulse + water shimmer
  '3711': [
    SPRITES['3711'].rows,  // frame 0
    [ // frame 1: sun rays brighten, water shifts
      '................',
      '...Y.Y....mm....',
      '..OYYYO..mwwm...',
      '.OYYYYYOm.mwwm..',
      '..OYYYO..mmmm...',
      '...Y.Y....mm....',
      '................',
      '................',
      '...bb..bb..bb...',
      '.bbbbbbbbbbbbbb.',
      '..bb..bb..bb..bb',
      '.bbbbbbbbbbbbbb.',
      '..bb..bb..bb..bb',
      '................',
      '................',
      '................',
    ],
    [ // frame 2: moon glows, water opposite phase
      '................',
      '...O.O....ww....',
      '..OYYYO..mwwm...',
      '.OYYYYYOm.mwwm..',
      '..OYYYO..mwww...',
      '...O.O....ww....',
      '................',
      '................',
      '..bb..bb..bb....',
      'bbbbbbbbbbbbbb..',
      '.bb..bb..bb..bb.',
      'bbbbbbbbbbbbbb..',
      '.bb..bb..bb..bb.',
      '................',
      '................',
      '................',
    ],
  ],

  // YZU dolphin: 3-frame jump arc (up → peak → down)
  'YZU': [
    [ // frame 0: low (diving)
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '..........BB....',
      '........BBwB....',
      '......BBBBBB....',
      '..BBBBBBBB......',
      '.BBBB....BB.....',
      'BBB....BB.......',
      '.BB...BB........',
      '..BB............',
      '................',
    ],
    SPRITES['YZU'].rows,  // frame 1: mid-air (base)
    [ // frame 2: peak (higher arc)
      '................',
      '..........BB....',
      '........BBwB....',
      '......BBBBBB....',
      '....BBBBBB......',
      '..BBBBBB........',
      '.BBBB....BB.....',
      'BBB....BB.......',
      '.BB...BB........',
      '..BB.BB.........',
      '...BB...........',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  ],

  // YOUJIAN mouse: scroll wheel moves down + LED blink
  'YOUJIAN': [
    SPRITES['YOUJIAN'].rows,  // frame 0
    [ // frame 1: wheel scrolled down 1px
      '................',
      '................',
      '....KKKKKK......',
      '..KKGGGGGGKK....',
      '.KGGGGGGGGGGK...',
      'KGGGGKGGGGGGGK..',
      'KGGGGKKKKGGGGK..',
      'KGGGGKwwKGGGGK..',
      'KGGGGKGGGGGGGK..',
      'KGGGGGGGGGGGGK..',
      'KGGGGGGGGGGGGK..',
      '.KGGGGGGGGGGK...',
      '..KKGGGGGGKK....',
      '....KKKKKK......',
      '................',
      '................',
    ],
    [ // frame 2: LED blink (red dot on mouse)
      '................',
      '................',
      '....KKKKKK......',
      '..KKGGGGGGKK....',
      '.KGGGGGGGGGGK...',
      'KGGGGKGGGGGGGK..',
      'KGGGGRwwKGGGGK..',
      'KGGGGKKKKGGGGK..',
      'KGGGGGGGGGGGGK..',
      'KGGGGGGGGGGGGK..',
      'KGGGGGGGGGGGGK..',
      '.KGGGGGGGGGGK...',
      '..KKGGGGGGKK....',
      '....KKKKKK......',
      '................',
      '................',
    ],
  ],

  // COIN: 4-frame spin (wide → narrow → wide → narrow)
  'COIN': [
    SPRITES['COIN'].rows,  // frame 0: full face
    [ // frame 1: narrow (edge-on, right-leaning)
      '................',
      '................',
      '......KK........',
      '.....KYYK.......',
      '....KYYYK.......',
      '....KYYYK.......',
      '....KYYYK.......',
      '....KYYYK.......',
      '....KYYYK.......',
      '....KYYYK.......',
      '....KYYYK.......',
      '.....KYYK.......',
      '......KK........',
      '................',
      '................',
      '................',
    ],
    [ // frame 2: full face (back side — plain)
      '................',
      '................',
      '....KKKKKK......',
      '..KYYYYYYYK.....',
      '.KYYYYYYYYYK....',
      'KYYYYYYYYYYYK...',
      'KYYYYYYYYYYYK...',
      'KYYYYYYYYYYYK...',
      'KYYYYYYYYYYYK...',
      'KYYYYYYYYYYYK...',
      '.KYYYYYYYYYK....',
      '..KYYYYYYYK.....',
      '....KKKKKK......',
      '................',
      '................',
      '................',
    ],
    [ // frame 3: narrow (edge-on, left-leaning)
      '................',
      '................',
      '........KK......',
      '.......KYYK.....',
      '.......KYYYK....',
      '.......KYYYK....',
      '.......KYYYK....',
      '.......KYYYK....',
      '.......KYYYK....',
      '.......KYYYK....',
      '.......KYYYK....',
      '.......KYYK.....',
      '........KK......',
      '................',
      '................',
      '................',
    ],
  ],
};

// ------------------------------------------------------------
//  RENDERER — converts sprite rows → SVG string
// ------------------------------------------------------------
export function renderSprite(spriteName, size, frameIndex = 0) {
  const sprite = SPRITES[spriteName];
  if (!sprite) return '';
  const frames = SPRITE_FRAMES[spriteName];
  const rows = frames ? frames[frameIndex % frames.length] : sprite.rows;
  const pal = sprite.palette;
  const cell = size / 16;
  let rects = '';
  rows.forEach((row, y) => {
    const padded = row.padEnd(16, '.');
    for (let x = 0; x < 16; x++) {
      const col = pal[padded[x]];
      if (col) {
        rects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${col}"/>`;
      }
    }
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" style="image-rendering:pixelated">${rects}</svg>`;
}

// ------------------------------------------------------------
//  CSS ANIMATION HELPERS — generates <style> + class names
//  Usage: injectSpriteCSS() once, then use class="px-anim px-anim-2330"
// ------------------------------------------------------------
export function spriteCSS() {
  let css = '';
  for (const name of Object.keys(SPRITE_FRAMES)) {
    const nFrames = SPRITE_FRAMES[name].length;
    const duration = nFrames * 0.18; // seconds per full cycle
    css += `.px-anim-${name}{animation:px-steps-${name} ${duration}s steps(${nFrames}) infinite;}\n`;
    css += `@keyframes px-steps-${name}{`;
    SPRITE_FRAMES[name].forEach((_, i) => {
      const pct = (i / nFrames * 100).toFixed(2);
      css += `${pct}%{background-image:url("data:image/svg+xml,${encodeURIComponent(renderSprite(name, 64, i))}");}`;
    });
    css += `}\n`;
  }
  return css;
}

// ------------------------------------------------------------
//  AMBIENT PAGE ANIMATIONS (pure CSS, zero server cost)
// ------------------------------------------------------------
export const AMBIENT_ANIMATIONS = [
  {
    name: 'blinking-cursor',
    description: 'Login screen blinking block cursor after the title',
    css: `
      .px-cursor{display:inline-block;width:10px;height:18px;background:var(--gold);
        vertical-align:-2px;margin-left:4px;animation:blink 1s steps(2) infinite;}
      @keyframes blink{50%{opacity:0;}}`,
    timing: '1s cycle, steps(2), infinite',
  },
  {
    name: 'price-flash',
    description: 'Stock card flashes red/green border on price change (Taiwan convention)',
    css: `
      .flash-up{animation:flashUp .4s steps(3);}
      .flash-down{animation:flashDown .4s steps(3);}
      @keyframes flashUp{0%{border-color:var(--red);box-shadow:0 0 12px var(--red);}100%{border-color:var(--line);box-shadow:6px 6px 0 rgba(0,0,0,.45);}}
      @keyframes flashDown{0%{border-color:var(--green);box-shadow:0 0 12px var(--green);}100%{border-color:var(--line);box-shadow:6px 6px 0 rgba(0,0,0,.45);}}`,
    timing: '0.4s, steps(3), triggered on price change event',
  },
  {
    name: 'ticker-tape',
    description: 'Scrolling ticker tape at the bottom of the main screen showing all stock prices',
    css: `
      .ticker-wrap{overflow:hidden;white-space:nowrap;border-top:2px solid var(--line);background:var(--panel);padding:6px 0;}
      .ticker-inner{display:inline-block;animation:ticker 20s linear infinite;}
      @keyframes ticker{0%{transform:translateX(100%);}100%{transform:translateX(-100%);}}`,
    timing: '20s linear infinite, pure CSS marquee',
  },
];
