'use strict';

window.onload = () => {
  const fromAlpha = (s) => s.split('').reduce((r, a) => r * 26 + parseInt(a, 36) - 9, 0) - 1;

  const toAlpha = (n) => {
    let result = '';
    do {
      result = (n % 26 + 10).toString(36) + result;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return result.toUpperCase();
  };

  const clampIndex = (idx, len) => {
    if (!len) return 0;
    const n = Number(idx) || 0;
    return ((n % len) + len) % len;
  };

  const getCoords = (compoundValue) => {
    for (let i = 0; i < compoundValue.length; i++) {
      if (/[A-Z]/.test(compoundValue[i])) continue;
      const x = compoundValue.substr(0, i);
      const y = compoundValue.substr(-(compoundValue.length - i));
      return [x, y];
    }
  };

  const findCenter = (endWidth, endHeight) => `${toAlpha(Math.floor(endWidth / 2))}${Math.floor(endHeight / 2)}`;

  const getActiveTiles = (theme) => {
    const tilesets = ['standard', 'resource', 'special'];
    const activeTiles = [];
    tilesets.forEach((tileset) => {
      const arr = (TILES?.[tileset]?.[theme]) || [];
      for (let i = 0; i < arr.length; i++) activeTiles.push(arr[i]);
    });
    return activeTiles;
  };

  // Every theme/palette (grass, sand, halloween, easter, winter, ...) is
  // read straight from data.js rather than hardcoded, so new palettes
  // just need an entry in TILES to show up here. Themes are NOT required
  // to share tile counts or ordering with each other.
  const THEME_KEYS = Object.keys(TILES?.standard || {});

  const themeTilesCache = new Map();
  const tilesForTheme = (theme) => {
    if (!themeTilesCache.has(theme)) themeTilesCache.set(theme, getActiveTiles(theme));
    return themeTilesCache.get(theme);
  };

  // Each painted cell remembers which theme/palette AND which tile (by
  // NAME) it was painted with, e.g. "halloween:Ghastly Mountain". Storing
  // the name instead of a position means adding, removing or reordering
  // tiles in data.js never changes what already-painted cells show.
  const encodeCell = (theme, idx) => {
    const name = tilesForTheme(theme)[idx]?.name;
    return `${theme}:${name !== undefined ? name : idx}`;
  };

  // Old saves/exports stored a position ("halloween:2" or a bare number)
  // instead of a name. Convert those using the tile order they were made
  // with (LEGACY_TILE_ORDER in data.js) so they still load correctly.
  const legacyToName = (theme, n) => {
    const legacy = (typeof LEGACY_TILE_ORDER !== 'undefined' && LEGACY_TILE_ORDER[theme]) || null;
    if (legacy) return legacy[n];
    return tilesForTheme(theme)[n]?.name;
  };

  const decodeCell = (raw) => {
    if (raw === undefined || raw === null) return null;

    if (typeof raw === 'number') return { theme: FIXED_THEME, name: legacyToName(FIXED_THEME, raw) };

    const s = String(raw);
    const sep = s.indexOf(':');
    if (sep === -1) {
      const n = Number(s);
      return Number.isFinite(n) ? { theme: FIXED_THEME, name: legacyToName(FIXED_THEME, n) } : null;
    }

    const theme = s.slice(0, sep);
    const rest = s.slice(sep + 1);
    if (rest !== '' && Number.isFinite(Number(rest))) {
      return { theme, name: legacyToName(theme, Number(rest)) };
    }
    return { theme, name: rest };
  };

  // Resolves a stored cell value to a concrete { theme, idx, tiles, tile }
  // regardless of which palette is currently active. If the theme no longer
  // exists it falls back to the default ground tile; if only the tile was
  // removed from data.js it falls back to that theme's first tile.
  const resolveCell = (raw) => {
    const data = decodeCell(raw);
    let theme = data ? data.theme : FIXED_THEME;
    let tiles = tilesForTheme(theme);

    if (!tiles.length) {
      theme = FIXED_THEME;
      tiles = tilesForTheme(FIXED_THEME);
    }

    let idx = data && data.name !== undefined ? tiles.findIndex((t) => t.name === data.name) : -1;
    if (idx < 0) idx = (data && tilesForTheme(data.theme).length) ? 0 : DEFAULT_TILE_INDEX;

    return { theme, idx, tiles, tile: tiles[idx] };
  };

  const makeTitleText = (data) => {
    return (
      `Name: ${data.name}\n` +
      `Energy Cost: ${data.cost}\n` +
      `Points: ${data.points}\n` +
      `Buildable: ${data.buildable}\n` +
      `Passable: ${data.passable}\n` +
      `Defense modifier: ${data.defense_modifier}\n` +
      `Attack modifier: ${data.attack_modifier}`
    );
  };

  const updateTile = (nextTile, cellIndex) => {
    const target = document.querySelector(`[data-cell='${cellIndex}']`);
    if (!target) return;

    const nextColor = nextTile.color;
    target.title = makeTitleText(nextTile);

    if (nextTile.src && nextTile.src.length) {
      for (const child of target.children) {
        if (child.classList.contains('left')) child.style.opacity = 0;
        else if (child.classList.contains('middle')) child.style.background = 'transparent';
        else if (child.classList.contains('right')) child.style.opacity = 0;
      }
      target.style.backgroundImage = `url(${nextTile.src})`;
    } else {
      target.style.backgroundImage = 'none';
      for (const child of target.children) {
        if (child.classList.contains('left')) {
          child.style.opacity = 1;
          child.style.borderRightColor = nextColor;
        } else if (child.classList.contains('middle')) {
          child.style.background = nextColor;
        } else if (child.classList.contains('right')) {
          child.style.opacity = 1;
          child.style.borderLeftColor = nextColor;
        }
      }
    }
  };

  const base64UrlEncode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const base64UrlDecode = (b64url) => {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  
  // Every map is generated at a fixed size and theme. There is no
  // per-map width/height/theme control anymore.
  const FIXED_WIDTH = 'AS';
  const FIXED_HEIGHT = 46;
  const FIXED_THEME = 'grass';
  const DEFAULT_TILE_INDEX = 0; // brand-new cells always start as the first palette tile

  const gridEl = document.getElementById('grid');
  const centerEl = document.getElementById('center');

  const buildableEl = document.getElementById('buildable');
  const pointsEl = document.getElementById('points');

  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const resetBtn = document.getElementById('reset');

  const exportJsonBtn = document.getElementById('export-json');
  const exportCodeBtn = document.getElementById('export-code');
  const exportPngBtn = document.getElementById('export-png');
  const importBtn = document.getElementById('import');

  const paletteEl = document.getElementById('palette');
  const paletteThemeBtn = document.getElementById('palette-theme-btn');
  const paletteThemeMenu = document.getElementById('palette-theme-menu');
  const paletteThemeLabel = document.getElementById('palette-theme-label');

  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalText = document.getElementById('modal-text');
  const modalHint = document.getElementById('modal-hint');
  const modalClose = document.getElementById('modal-close');
  const modalPrimary = document.getElementById('modal-primary');
  const modalSecondary = document.getElementById('modal-secondary');

  
  const gridColors = JSON.parse(localStorage.getItem('hexMap')) || {};

  const endWidth = fromAlpha(FIXED_WIDTH);
  const endHeight = FIXED_HEIGHT;

  // "paletteTheme" is which palette (grass/sand/halloween/etc) the brush is
  // currently painting from. It only decides what's offered in the Palette
  // panel and what gets stamped onto newly-painted cells — it has no effect
  // on the map's fixed base theme, and switching it never touches tiles
  // already on the map (each of those remembers its own theme, see above).
  let paletteTheme = String(localStorage.getItem('paletteTheme') || '').trim();
  if (!THEME_KEYS.includes(paletteTheme)) paletteTheme = THEME_KEYS.includes(FIXED_THEME) ? FIXED_THEME : (THEME_KEYS[0] || FIXED_THEME);

  let activeTiles = tilesForTheme(paletteTheme);

  // "selectedIndex" is the paint tool (which tile within the active
  // palette the brush currently places), independent from
  // DEFAULT_TILE_INDEX which is what a brand new, never-painted cell
  // starts out as (always the map's fixed base theme).
  let selectedIndex = clampIndex(localStorage.getItem('selectedTile'), activeTiles.length);

  const legacyFill = localStorage.getItem('fillColor');
  if (legacyFill !== null && legacyFill !== undefined) {
    selectedIndex = clampIndex(legacyFill, activeTiles.length);
    localStorage.setItem('selectedTile', String(selectedIndex));
    localStorage.removeItem('fillColor');
  }

  // Clean up now-unused legacy keys from earlier versions of the app
  // that had per-map width/height/theme controls.
  localStorage.removeItem('width');
  localStorage.removeItem('height');
  localStorage.removeItem('theme');
  localStorage.removeItem('change-theme');

  const counters = { buildable: 0, points: 0 };

  
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 200;

  let strokeBefore = null; 
  let strokeAfter = null;  
  let isPainting = false;
  let lastCell = null;

  
  const updateUndoRedoUI = () => {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  };

  const updateStatsUI = () => {
    if (buildableEl) buildableEl.textContent = `${Math.round(counters.buildable / 4)} / ${counters.buildable}`;
    if (pointsEl) pointsEl.textContent = `${Math.round(counters.points / 4)} / ${counters.points}`;
  };

  const recalcCountersFromDOM = () => {
    counters.buildable = 0;
    counters.points = 0;

    const hexes = document.querySelectorAll('#grid .hexagon');
    for (const hex of hexes) {
      const cell = hex.dataset.cell;
      if (!cell) continue;

      const resolved = resolveCell(gridColors[cell]);
      gridColors[cell] = encodeCell(resolved.theme, resolved.idx);

      const t = resolved.tile;
      if (!t) continue;

      counters.buildable += t.buildable ? 1 : 0;
      counters.points += Number(t.points) || 0;
    }

    updateStatsUI();
  };

  const shouldSkipFromPalette = (tileObj) => {
    if (!tileObj) return true;

    if (paletteTheme === 'easter') {
      const n = String(tileObj.name || '').toLowerCase();
      const isBaseResource = n === 'mine' || n === 'library' || n === 'remote village' || n === 'village';
      const src = String(tileObj.src || '');
      const isEasterBaseResourceSrc =
        src.includes('./img/resource/easter/Mine.png') ||
        src.includes('./img/resource/easter/Library.png') ||
        src.includes('./img/resource/easter/Village.png');

      if (isBaseResource && isEasterBaseResourceSrc) return true;
    }

    return false;
  };

  const highlightPaletteSelection = () => {
    if (!paletteEl) return;
    for (const el of paletteEl.querySelectorAll('.palette-item')) {
      const elIdx = Number(el.dataset.index);
      el.classList.toggle('selected', elIdx === selectedIndex);
    }
  };

  const setSelectedIndex = (idx) => {
    selectedIndex = clampIndex(idx, activeTiles.length);
    localStorage.setItem('selectedTile', String(selectedIndex));
    highlightPaletteSelection();
  };

  const buildPalette = () => {
    if (!paletteEl) return;
    paletteEl.innerHTML = '';

    for (let idx = 0; idx < activeTiles.length; idx++) {
      const t = activeTiles[idx];
      if (shouldSkipFromPalette(t)) continue;

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'palette-item';
      item.dataset.index = String(idx);
      item.title = makeTitleText(t);

      if (t.src && t.src.length) {
        item.style.backgroundImage = `url(${t.src})`;
      } else {
        item.classList.add('color-fallback');
        const swatch = document.createElement('div');
        swatch.classList.add('swatch');
        swatch.style.background = t.color;
        item.appendChild(swatch);
      }

      item.addEventListener('click', () => setSelectedIndex(idx));
      paletteEl.appendChild(item);
    }

    highlightPaletteSelection();
  };

  const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());

  const buildPaletteThemeMenu = () => {
    if (!paletteThemeMenu) return;
    paletteThemeMenu.innerHTML = '';

    for (const theme of THEME_KEYS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-item';
      item.dataset.value = theme;
      item.textContent = titleCase(theme);
      paletteThemeMenu.appendChild(item);
    }
  };

  const updatePaletteThemeUI = () => {
    if (paletteThemeLabel) paletteThemeLabel.textContent = titleCase(paletteTheme);

    if (paletteThemeMenu) {
      for (const btn of paletteThemeMenu.querySelectorAll('.dropdown-item')) {
        btn.classList.toggle('active', btn.dataset.value === paletteTheme);
      }
    }
  };

  const togglePaletteThemeMenu = (forceOpen = null) => {
    if (!paletteThemeBtn || !paletteThemeMenu) return;
    const isOpen = paletteThemeBtn.getAttribute('aria-expanded') === 'true';
    const next = forceOpen === null ? !isOpen : !!forceOpen;
    paletteThemeBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
    paletteThemeMenu.classList.toggle('open', next);
  };

  // Switching the active palette only changes what's available to paint
  // WITH from here on — it never touches tiles already placed on the map.
  const setPaletteTheme = (theme) => {
    if (!THEME_KEYS.includes(theme) || theme === paletteTheme) return;

    paletteTheme = theme;
    localStorage.setItem('paletteTheme', paletteTheme);

    activeTiles = tilesForTheme(paletteTheme);
    selectedIndex = 0;
    localStorage.setItem('selectedTile', String(selectedIndex));

    updatePaletteThemeUI();
    buildPalette();
  };

  const isValidCell = (cell) => {
    const parts = getCoords(cell);
    if (!parts) return false;
    const [x, yStr] = parts;
    const xN = fromAlpha(x);
    const yN = parseInt(yStr, 10);
    if (!Number.isFinite(xN) || !Number.isFinite(yN)) return false;
    if (xN < 0 || xN > endWidth) return false;
    if (yN < 1 || yN > endHeight) return false;
    return true;
  };

  const pruneGridColorsToCurrentSize = () => {
    for (const key of Object.keys(gridColors)) {
      if (!isValidCell(key)) delete gridColors[key];
    }
  };

  const makeHexagon = (text = '', even = false, hidden = false) => {
    const hexagon = document.createElement('div');
    const left = document.createElement('div');
    const middle = document.createElement('div');
    const right = document.createElement('div');

    hexagon.classList.add('hexagon');
    left.classList.add('left');
    middle.classList.add('middle');
    right.classList.add('right');

    middle.innerText = text;
    hexagon.setAttribute('data-cell', text);

    if (even) hexagon.classList.add('even');
    if (hidden) hexagon.style.visibility = 'hidden';

    const resolved = resolveCell(gridColors[text]);
    gridColors[text] = encodeCell(resolved.theme, resolved.idx);

    const currentTile = resolved.tile || resolved.tiles[0];
    hexagon.title = makeTitleText(currentTile);

    if (currentTile?.src && currentTile.src.length) {
      hexagon.style.backgroundImage = `url(${currentTile.src})`;
    } else {
      left.style.opacity = 1;
      left.style.borderRightColor = currentTile.color;
      middle.style.background = currentTile.color;
      right.style.opacity = 1;
      right.style.borderLeftColor = currentTile.color;
    }

    counters.buildable += currentTile.buildable ? 1 : 0;
    counters.points += Number(currentTile.points) || 0;

    hexagon.appendChild(left);
    hexagon.appendChild(middle);
    hexagon.appendChild(right);

    return hexagon;
  };

  const makeHexagonRow = (rowIndex, staggered = false) => {
    const hexagonRow = document.createElement('div');
    hexagonRow.classList.add('hexagon-row');

    for (let w = fromAlpha('A'); w <= endWidth; w++) {
      const hideHexagon = staggered && w % 2 === 0;
      hexagonRow.appendChild(makeHexagon(toAlpha(w) + rowIndex, !(w % 2), hideHexagon));
    }
    return hexagonRow;
  };

  const rebuildGridDOM = () => {
    if (!gridEl) return;

    counters.buildable = 0;
    counters.points = 0;

    pruneGridColorsToCurrentSize();

    gridEl.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let h = 1; h <= endHeight; h++) {
      fragment.appendChild(makeHexagonRow(h, h >= endHeight));
    }

    const columns = endWidth + 1;
    gridEl.style.width = columns * 95 + 100 + 'px';

    gridEl.appendChild(fragment);

    localStorage.setItem('hexMap', JSON.stringify(gridColors));
    updateStatsUI();
    renderAll();
  };

  const getMirrors = (cellIndex) => {
    const [xAlpha, yStr] = getCoords(cellIndex);
    const y = Number(yStr);
    const x = fromAlpha(xAlpha);

    return [
      xAlpha + y,
      xAlpha + (x % 2 ? 1 + endHeight - y : endHeight - y),
      toAlpha(endWidth - x) + y,
      toAlpha(endWidth - x) + (x % 2 ? 1 + endHeight - y : endHeight - y)
    ];
  };

  const recordStrokeChange = (cell, beforeIdx, afterIdx) => {
    if (!strokeBefore || !strokeAfter) return;

    if (!strokeBefore.has(cell)) strokeBefore.set(cell, beforeIdx);
    strokeAfter.set(cell, afterIdx);
  };

  const applyPaintToCell = (cellIndex) => {
    const mirrors = getMirrors(cellIndex);

    mirrors.forEach((cell) => {
      if (!isValidCell(cell)) return;

      const beforeRaw = gridColors[cell];
      const before = resolveCell(beforeRaw);
      const oldTile = before.tile;

      if (oldTile) {
        counters.buildable -= oldTile.buildable ? 1 : 0;
        counters.points -= Number(oldTile.points) || 0;
      }

      const afterIdx = clampIndex(selectedIndex, activeTiles.length);
      gridColors[cell] = encodeCell(paletteTheme, afterIdx);

      const nextTile = activeTiles[afterIdx];
      if (!nextTile) return;

      updateTile(nextTile, cell);

      counters.buildable += nextTile.buildable ? 1 : 0;
      counters.points += Number(nextTile.points) || 0;

      recordStrokeChange(cell, encodeCell(before.theme, before.idx), gridColors[cell]);
    });

    localStorage.setItem('hexMap', JSON.stringify(gridColors));
    updateStatsUI();
    queueEnergyRefresh();
  };

  const pushHistory = (beforeMap, afterMap) => {
    const beforeObj = {};
    const afterObj = {};

    for (const [k, v] of beforeMap.entries()) beforeObj[k] = v;
    for (const [k, v] of afterMap.entries()) afterObj[k] = v;

    const keys = Object.keys(afterObj);
    if (!keys.length) return;

    undoStack.push({ before: beforeObj, after: afterObj });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();

    redoStack.length = 0;
    updateUndoRedoUI();
  };

  const applyHistoryState = (stateObj) => {
    for (const cell of Object.keys(stateObj)) {
      if (!isValidCell(cell)) continue;

      const resolved = resolveCell(stateObj[cell]);
      gridColors[cell] = encodeCell(resolved.theme, resolved.idx);

      if (resolved.tile) updateTile(resolved.tile, cell);
    }

    localStorage.setItem('hexMap', JSON.stringify(gridColors));
    recalcCountersFromDOM();
    queueEnergyRefresh();
  };

  const undo = () => {
    if (!undoStack.length) return;
    const entry = undoStack.pop();
    redoStack.push(entry);
    if (entry.pieces) setPieces(entry.pieces.before);
    else applyHistoryState(entry.before);
    updateUndoRedoUI();
  };

  const redo = () => {
    if (!redoStack.length) return;
    const entry = redoStack.pop();
    undoStack.push(entry);
    if (entry.pieces) setPieces(entry.pieces.after);
    else applyHistoryState(entry.after);
    updateUndoRedoUI();
  };

  
  // The map's size and base theme are fixed for every map, so exports
  // mainly carry the tile layout (each cell already remembers its own
  // theme+tile) plus which palette/tile the brush currently has selected.
  const buildExportPayload = () => {
    return {
      v: 1,
      width: FIXED_WIDTH,
      height: FIXED_HEIGHT,
      theme: FIXED_THEME,
      paletteTheme,
      selectedTile: selectedIndex,
      gridColors,
      pieces
    };
  };

  const buildCompressedCode = () => {
    
    const payload = buildExportPayload();
    const compact = {
      v: payload.v,
      w: payload.width,
      h: payload.height,
      t: payload.theme,
      pt: payload.paletteTheme,
      s: payload.selectedTile,
      g: payload.gridColors,
      p: payload.pieces
    };
    const json = JSON.stringify(compact);
    return `HM1:${base64UrlEncode(json)}`;
  };

  const parseImportText = (text) => {
    const trimmed = String(text || '').trim();

    if (trimmed.startsWith('HM1:')) {
      const raw = trimmed.slice(4);
      const json = base64UrlDecode(raw);
      const compact = JSON.parse(json);

      if (!compact || typeof compact !== 'object' || !compact.g) return null;

      return {
        v: compact.v || 1,
        paletteTheme: compact.pt,
        selectedTile: compact.s,
        gridColors: compact.g,
        pieces: compact.p
      };
    }

    
    return JSON.parse(trimmed);
  };

  const applyImportPayload = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.gridColors || typeof obj.gridColors !== 'object') return false;

    if (obj.paletteTheme && THEME_KEYS.includes(obj.paletteTheme)) {
      paletteTheme = obj.paletteTheme;
      localStorage.setItem('paletteTheme', paletteTheme);
      activeTiles = tilesForTheme(paletteTheme);
    }

    if (obj.selectedTile !== undefined) {
      selectedIndex = clampIndex(obj.selectedTile, activeTiles.length);
      localStorage.setItem('selectedTile', String(selectedIndex));
    }

    
    for (const k of Object.keys(gridColors)) delete gridColors[k];
    for (const k of Object.keys(obj.gridColors)) gridColors[k] = obj.gridColors[k];

    // Towers travel with the map; older exports simply have none.
    pieces = sanitizePieces(obj.pieces || []);
    savePieces();

    return true;
  };

  
  const exportPNG = async () => {
  try {
    const grid = document.getElementById('grid');
    if (!grid) return;

    // Skip hexes that are hidden on screen (the filler cells in the last row);
    // otherwise they get drawn as an extra row of default tiles.
    const hexes = Array.from(grid.querySelectorAll('.hexagon')).filter(
      (hex) => hex.style.visibility !== 'hidden'
    );
    if (!hexes.length) return;

    
    const gridRect = grid.getBoundingClientRect();

    // Size the canvas to the visible hexes only, not the whole grid box.
    let maxRight = 0;
    let maxBottom = 0;
    for (const hex of hexes) {
      const r = hex.getBoundingClientRect();
      maxRight = Math.max(maxRight, r.right - gridRect.left);
      maxBottom = Math.max(maxBottom, r.bottom - gridRect.top);
    }

    const padding = 70; // tall towers can rise above the first row
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(maxRight + padding * 2);
    canvas.height = Math.ceil(maxBottom + padding * 2);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    
    ctx.fillStyle = '#282828';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    
    const imgCache = new Map();
    const loadImage = (src) =>
      new Promise((resolve) => {
        if (imgCache.has(src)) return resolve(imgCache.get(src));

        const img = new Image();
        img.onload = () => {
          imgCache.set(src, img);
          resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });

    
    const extractUrl = (bg) => {
      if (!bg || bg === 'none') return null;
      const m = bg.match(/url\(["']?(.*?)["']?\)/i);
      return m ? m[1] : null;
    };

    
    const drawHexFallback = (x, y, w, h, color) => {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2;
      const ry = h / 2;

      ctx.fillStyle = color || '#444';
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy);
      ctx.lineTo(cx - rx / 2, cy - ry);
      ctx.lineTo(cx + rx / 2, cy - ry);
      ctx.lineTo(cx + rx, cy);
      ctx.lineTo(cx + rx / 2, cy + ry);
      ctx.lineTo(cx - rx / 2, cy + ry);
      ctx.closePath();
      ctx.fill();
    };

    
    for (const hex of hexes) {
      const cell = hex.dataset.cell;
      if (!cell) continue;

      const r = hex.getBoundingClientRect();

      
      const x = (r.left - gridRect.left) + padding + grid.scrollLeft;
      const y = (r.top - gridRect.top) + padding + grid.scrollTop;
      const w = r.width;
      const h = r.height;

      const bg = getComputedStyle(hex).backgroundImage;
      const url = extractUrl(bg);

      if (url) {
        const img = await loadImage(url);
        if (img) {
          const iw = img.naturalWidth || w;
          const ih = img.naturalHeight || h;
          const k = Math.min(w / iw, h / ih);          // CSS "contain"
          const dw = iw * k;
          const dh = ih * k;
          ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
          continue;
        }
      }

      
      const tile = resolveCell(gridColors[cell]).tile;
      drawHexFallback(x, y, w, h, tile?.color || '#444');
    }

    // Territory first, then towers / labels above everything.
    const box = Conquest.OVERLAY_BOX;
    for (const layer of ['base', 'top']) {
      for (const hex of hexes) {
        const layers = overlaySvgByCell.get(hex.dataset.cell);
        if (!layers || !layers[layer]) continue;

        const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(layers[layer]));
        if (!img) continue;

        const r = hex.getBoundingClientRect();
        ctx.drawImage(
          img,
          (r.left - gridRect.left) + padding + grid.scrollLeft + box.x,
          (r.top - gridRect.top) + padding + grid.scrollTop + box.y,
          box.w,
          box.h
        );
      }
    }

    const filename = `hex_map_${FIXED_WIDTH}_${FIXED_HEIGHT}.png`;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('toBlob failed');

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (err) {
    console.error(err);
    alert('PNG export failed. Open DevTools Console to see the error.');
  }
};

  
  let modalMode = 'export-json';

  const openModal = (mode) => {
    modalMode = mode;
    if (!modal || !modalTitle || !modalText || !modalHint || !modalPrimary) return;

    if (mode === 'export-json') {
      modalTitle.textContent = 'Export JSON';
      modalPrimary.textContent = 'Copy';
      modalHint.textContent = 'Readable JSON export.';
      modalText.value = JSON.stringify(buildExportPayload(), null, 2);
      modalText.readOnly = true;
    } else if (mode === 'export-code') {
      modalTitle.textContent = 'Export Code';
      modalPrimary.textContent = 'Copy';
      modalHint.textContent = 'Shorter share code (paste into Import).';
      modalText.value = buildCompressedCode();
      modalText.readOnly = true;
    } else {
      modalTitle.textContent = 'Import';
      modalPrimary.textContent = 'Import';
      modalHint.textContent = 'Paste JSON export or HM1: share code.';
      modalText.value = '';
      modalText.readOnly = false;
    }

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');

    modalText.focus();
    modalText.select();
  };

  const closeModal = () => {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
  };

   // ==========================================================================
  //  CONQUEST OVERLAY: towers, territory, strongholds, energy and
  //  the path finder. Rules and artwork live in conquest.js; this part wires
  //  them to the page. Towers are stored apart from the terrain, so they
  //  never touch tiles.
  // ==========================================================================
  const SH = Conquest.STRONGHOLD;
  const $ = (id) => document.getElementById(id);

  const tabsEl = $('tabs');
  const toolModesEl = $('tool-modes');
  const toolOptionsEl = $('tool-options');
  const teamPickerEl = $('team-picker');
  const levelWrapEl = $('level-wrap');
  const levelPickerEl = $('level-picker');
  const nameWrapEl = $('name-wrap');
  const nameLabelEl = $('name-label');
  const pieceNameEl = $('piece-name');
  const showTerritoryEl = $('show-territory');
  const showNamesEl = $('show-names');
  const showCostsEl = $('show-costs');

  const ovMsgEl = $('ov-msg');
  const ovTowersEl = $('ov-towers');
  const ovCountEl = $('overview-count');
  const docksTopEl = $('strongholds');
  const docksBottomEl = $('strongholds-bottom');
  const meBadgeEl = $('me-badge');
  const hoverEl = $('hover-info');

  const myTeamEl = $('my-team');
  const techEls = { general: $('tech-general'), alliance: $('tech-alliance'), enemy: $('tech-enemy') };
  const techSummaryEl = $('tech-summary');
  const pathFromEl = $('path-from');
  const pathToEl = $('path-to');
  const pathShBtn = $('path-sh');
  const perMoveEl = $('path-per-move');
  const pathResultEl = $('path-result');
  const pathBannerEl = $('path-banner');

  // Hexes that exist on screen (the even-column cells of the last row are hidden fillers).
  const isPlayableSpot = (col, row) => {
    if (col < 0 || col > endWidth) return false;
    if (row < 1 || row > endHeight) return false;
    if (row === endHeight && col % 2 === 0) return false;
    return true;
  };

  const isPlayableCell = (cell) => {
    const p = Conquest.parseCell(cell);
    return !!p && isPlayableSpot(p.col, p.row);
  };

  const clonePieces = (arr) => arr.map((p) => ({ ...p }));

  const sanitizePieces = (arr) =>
    Conquest.normalizePieces(arr).filter((p) => p.cell === SH || isPlayableCell(p.cell));

  const readJSON = (key, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (err) {
      return fallback;
    }
  };

  let pieces = sanitizePieces(readJSON('hexPieces', []));
  const savePieces = () => localStorage.setItem('hexPieces', JSON.stringify(pieces));

  const viewPrefs = Object.assign({ territory: true, names: true, costs: false }, readJSON('hexView', {}));
  const saveViewPrefs = () => localStorage.setItem('hexView', JSON.stringify(viewPrefs));

  let activeTab = 'build';
  let toolMode = 'terrain'; // terrain | tower | erase   (Build tab only)
  let toolTeam = Conquest.TEAMS[localStorage.getItem('toolTeam')] ? localStorage.getItem('toolTeam') : 'red';
  let toolLevel = 1;

  // What clicking a tile does depends on the tab you are on, so a click
  // never builds something while you are looking at another tab.
  const activeMode = () => {
    if (activeTab === 'build') return toolMode;
    if (activeTab === 'energy') return 'path';
    return 'none';
  };

  // Energy settings: which team you are, your techs (percent), tiles per move.
  let myTeam = Conquest.TEAMS[localStorage.getItem('myTeam')] ? localStorage.getItem('myTeam') : '';
  const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0));
  const clampMove = (v) => Math.min(20, Math.max(1, Math.round(Number(v)) || Conquest.TILES_PER_MOVE));
  const savedTechs = readJSON('hexTechs', {});
  const techs = { general: clampPct(savedTechs.general), alliance: clampPct(savedTechs.alliance), enemy: clampPct(savedTechs.enemy) };
  let perMove = clampMove(localStorage.getItem('hexPerMove') || Conquest.TILES_PER_MOVE);

  let pathStart = ''; // a tile, or SH for "from my stronghold"
  let pathEnd = '';
  let pathResult = null;
  let lastTerritory = new Map();

  const newId = () => pieces.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const fmt = (n) => String(Math.round(n));

  // ---- energy: costs, territory, path --------------------------------------
  const tileAt = (cell) => resolveCell(gridColors[cell]).tile;

  // Energy to step onto a hex with the current team + techs, or null if impassable.
  const energyFor = (cell, territory) => {
    const tile = tileAt(cell);
    if (!tile || !tile.passable) return null;
    const owner = territory.get(cell) ? territory.get(cell).team : null;
    return Conquest.effectiveCost(Number(tile.cost) || 0, owner, myTeam, techs);
  };

  const pathStartCell = () => (pathStart === SH ? (myTeam ? Conquest.STRONGHOLD_ENTRY[myTeam] : '') : pathStart);

  const recomputePath = (territory) => {
    pathResult = null;
    if (!pathStart || !pathEnd) return;

    const costAt = (col, row) => {
      if (!isPlayableSpot(col, row)) return null;
      return energyFor(Conquest.cellId(col, row), territory);
    };

    if (pathStart === SH) {
      if (!myTeam) {
        pathResult = { ok: false, reason: 'Pick your team first.' };
        return;
      }
      pathResult = Conquest.findPath(SH, pathEnd, costAt, { entry: Conquest.STRONGHOLD_ENTRY[myTeam] });
    } else {
      pathResult = Conquest.findPath(pathStart, pathEnd, costAt);
    }
  };

  const pathTileCount = () => (pathResult && pathResult.ok
    ? (pathResult.fromStronghold ? pathResult.cells.length : pathResult.cells.length - 1)
    : 0);

  // ---- drawing -------------------------------------------------------------
  let overlaySvgByCell = new Map(); // also used by the PNG export

  // One overlay element per layer; created on demand, removed when empty.
  const setLayer = (hex, prop, cls, svg) => {
    let el = hex[prop];

    if (!svg) {
      if (el) {
        el.remove();
        hex[prop] = null;
      }
      return;
    }

    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      hex.appendChild(el);
      hex[prop] = el;
    }

    if (el._svg !== svg) {
      el.innerHTML = svg;
      el._svg = svg;
    }
  };

  const renderOverlays = () => {
    if (!gridEl) return;

    const territory = viewPrefs.territory ? lastTerritory : new Map();

    const byCell = new Map();
    for (const p of pieces) {
      if (p.cell === SH) continue;
      if (!byCell.has(p.cell)) byCell.set(p.cell, []);
      byCell.get(p.cell).push(p);
    }

    // A / B markers, the route, and the end of each move
    const pathInfo = new Map();
    if (pathResult && pathResult.ok) {
      for (const [k, v] of Conquest.pathInfoMap(pathResult.cells, { fromStronghold: pathResult.fromStronghold, perMove })) pathInfo.set(k, v);
    } else {
      const a = pathStartCell();
      if (a) pathInfo.set(a, { index: 0, isStart: true, isEnd: false, prevSide: -1, nextSide: -1, moveEnd: 0 });
      if (pathEnd) pathInfo.set(pathEnd, { index: 0, isStart: false, isEnd: true, prevSide: -1, nextSide: -1, moveEnd: 0 });
    }

    overlaySvgByCell = new Map();

    for (const hex of gridEl.querySelectorAll('.hexagon')) {
      const cell = hex.dataset.cell;
      if (!cell) continue;

      let cost = null;
      if (viewPrefs.costs && isPlayableCell(cell)) {
        const tile = tileAt(cell);
        const eff = energyFor(cell, lastTerritory);
        if (tile && eff !== null) {
          const base = Number(tile.cost) || 0;
          cost = { text: fmt(eff), tone: eff < base ? 'down' : eff > base ? 'up' : 'same' };
        }
      }

      const layers = Conquest.overlayLayers(cell, territory, byCell.get(cell) || [], {
        showNames: viewPrefs.names,
        path: pathInfo.get(cell) || null,
        cost
      });

      setLayer(hex, '_ovBase', 'hex-overlay', layers.base);
      setLayer(hex, '_ovTop', 'hex-overlay hex-top', layers.top);
      if (layers.base || layers.top) overlaySvgByCell.set(cell, layers);
    }
  };

  // Territory -> path -> map. Run whenever pieces, techs, team or terrain change.
  const refreshEnergy = () => {
    lastTerritory = Conquest.computeTerritory(pieces.filter((p) => p.type === 'tower'), isPlayableSpot);
    recomputePath(lastTerritory);
    renderOverlays();
    renderPathUI();
    renderHover();
  };

  let energyRaf = 0;
  // Painting terrain changes costs, so refresh (at most once per frame) when it matters.
  const queueEnergyRefresh = () => {
    if (!viewPrefs.costs && !(pathStart && pathEnd)) return;
    if (energyRaf) return;
    energyRaf = requestAnimationFrame(() => {
      energyRaf = 0;
      refreshEnergy();
    });
  };

  // ---- tower rows (Towers tab) ----------------------------------------------
  const openGroups = new Set(readJSON('hexOpenGroups', ['towers:red', 'towers:yellow', 'towers:green', 'towers:blue']));
  const saveOpenGroups = () => localStorage.setItem('hexOpenGroups', JSON.stringify([...openGroups]));

  const makeOvRow = (piece) => {
    const team = Conquest.TEAMS[piece.team];
    const row = document.createElement('div');
    row.className = 'ov-row tower';

    const live = () => pieces.find((p) => p.id === piece.id);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'ov-dot';
    dot.style.background = team.color;
    dot.title = `${team.label}, click to change`;
    dot.addEventListener('click', () => {
      commitPieces(() => {
        const p = live();
        if (!p) return;
        const keys = Conquest.CORNER_ORDER;
        p.team = keys[(keys.indexOf(p.team) + 1) % keys.length];
      });
    });
    row.appendChild(dot);

    const note = document.createElement('input');
    note.type = 'text';
    note.className = 'ov-input name';
    note.value = piece.note || '';
    note.maxLength = Conquest.MAX_NOTE;
    note.placeholder = 'Note';
    note.addEventListener('change', () => {
      commitPieces(() => {
        const p = live();
        if (p) p.note = Conquest.cleanNote(note.value);
      });
    });
    row.appendChild(note);

    const lvl = document.createElement('select');
    lvl.className = 'ov-level';
    lvl.title = 'Level';
    for (let i = 0; i <= Conquest.MAX_LEVEL; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `Lv ${i}`;
      lvl.appendChild(o);
    }
    lvl.value = String(piece.level);
    lvl.addEventListener('change', () => {
      commitPieces(() => {
        const p = live();
        if (p) p.level = Number(lvl.value);
      });
    });
    row.appendChild(lvl);

    const pos = document.createElement('input');
    pos.type = 'text';
    pos.className = 'ov-input pos';
    pos.value = piece.cell;
    pos.maxLength = 8;
    pos.title = 'Position';
    pos.addEventListener('change', () => {
      const next = Conquest.normalizePosition(pos.value);
      let problem = '';

      if (!next || next === SH) problem = 'Type a position like D32.';
      else if (!isPlayableCell(next)) problem = `${next} is not on the map.`;
      else if (pieces.some((p) => p.type === 'tower' && p.cell === next && p.id !== piece.id)) problem = `${next} already has a tower.`;

      if (problem) {
        pos.classList.add('bad');
        pos.value = piece.cell;
        showOvMsg(problem);
        return;
      }

      showOvMsg('');
      commitPieces(() => {
        const p = live();
        if (p) p.cell = next;
      });
    });
    row.appendChild(pos);

    for (const spec of [
      { text: '\u2316', title: 'Show on map', run: () => locateCell(piece.cell) },
      {
        text: '\u2715',
        title: 'Remove',
        run: () => commitPieces(() => { pieces = pieces.filter((p) => p.id !== piece.id); })
      }
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ov-btn';
      b.textContent = spec.text;
      b.title = spec.title;
      b.addEventListener('click', spec.run);
      row.appendChild(b);
    }

    for (const input of row.querySelectorAll('input')) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }

    return row;
  };

  const emptyNote = (text) => {
    const d = document.createElement('div');
    d.className = 'ov-empty';
    d.textContent = text;
    return d;
  };

  const teamLabelHTML = (key) => {
    const t = Conquest.TEAMS[key];
    return `<span class="team-swatch" style="background:${t.color}"></span><span>${t.label}</span><span class="team-corner">${t.cornerLabel}</span>`;
  };

  // One collapsible drop-down per team, in map order.
  const renderGrouped = (container, list, kind, emptyText) => {
    const groups = [];
    for (const key of Conquest.CORNER_ORDER) {
      const items = list.filter((p) => p.team === key);
      if (!items.length) continue;

      const det = document.createElement('details');
      det.className = 'team-group';
      det.open = openGroups.has(`${kind}:${key}`);
      det.addEventListener('toggle', () => {
        if (det.open) openGroups.add(`${kind}:${key}`);
        else openGroups.delete(`${kind}:${key}`);
        saveOpenGroups();
      });

      const sum = document.createElement('summary');
      sum.innerHTML = `${teamLabelHTML(key)}<span class="team-count">${items.length}</span>`;
      det.appendChild(sum);

      const body = document.createElement('div');
      body.className = 'ov-list';
      for (const piece of items) body.appendChild(makeOvRow(piece));
      det.appendChild(body);

      groups.push(det);
    }

    container.replaceChildren(...(groups.length ? groups : [emptyNote(emptyText)]));
  };

  const renderOverview = () => {
    if (!ovTowersEl) return;

    const towers = pieces.filter((p) => p.type === 'tower');
    if (ovCountEl) ovCountEl.textContent = `${towers.length} tower${towers.length === 1 ? '' : 's'}`;

    renderGrouped(ovTowersEl, towers, 'towers', 'No towers');
  };

  // ---- corner docks: each alliance's stronghold sits in its own corner -----
  const renderStrongholds = () => {
    if (!docksTopEl || !docksBottomEl) return;

    const width = gridEl && gridEl.style.width ? gridEl.style.width : '';
    docksTopEl.style.width = width;
    docksBottomEl.style.width = width;

    const makeCard = (key) => {
      const team = Conquest.TEAMS[key];
      const right = team.corner === 'ne' || team.corner === 'se';

      const card = document.createElement('div');
      card.className = `sh-card ${right ? 'right' : 'left'}${myTeam === key ? ' me' : ''}`;
      card.style.borderColor = team.color;
      card.innerHTML = `${Conquest.strongholdSVG(key, 64)}<div><div class="sh-title">${team.label}${myTeam === key ? '<span class="sh-you">YOU</span>' : ''}</div><div class="sh-sub">${team.cornerLabel}</div></div>`;
      return card;
    };

    docksTopEl.replaceChildren(makeCard('yellow'), makeCard('green'));
    docksBottomEl.replaceChildren(makeCard('blue'), makeCard('red'));
  };

  // ---- energy panel: team, techs, path -------------------------------------
  const buildCompass = () => {
    if (!myTeamEl) return;
    myTeamEl.replaceChildren();

    for (const key of Conquest.CORNER_ORDER) {
      const t = Conquest.TEAMS[key];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'compass-btn';
      b.dataset.team = key;
      b.style.background = t.color;
      b.innerHTML = `${t.label}<small>${t.cornerLabel}</small>`;
      b.addEventListener('click', () => setMyTeam(key));
      myTeamEl.appendChild(b);
    }

    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'compass-none';
    none.dataset.team = '';
    none.textContent = 'None';
    none.addEventListener('click', () => setMyTeam(''));
    myTeamEl.appendChild(none);
  };

  const updateEnergyUI = () => {
    if (myTeamEl) {
      for (const b of myTeamEl.querySelectorAll('[data-team]')) b.classList.toggle('active', b.dataset.team === myTeam);
    }

    if (meBadgeEl) {
      meBadgeEl.hidden = !myTeam;
      if (myTeam) {
        const t = Conquest.TEAMS[myTeam];
        meBadgeEl.textContent = `You: ${t.label}`;
        meBadgeEl.style.background = t.color;
      }
    }

    for (const key of Object.keys(techEls)) {
      if (techEls[key] && document.activeElement !== techEls[key]) techEls[key].value = String(techs[key]);
    }

    if (perMoveEl && document.activeElement !== perMoveEl) perMoveEl.value = String(perMove);

    if (techSummaryEl) {
      const m = Conquest.multipliers(techs);
      const chip = (cls, label, mult) =>
        `<div class="mult ${cls}"><span>${label}</span><b>\u00d7${(Math.round(mult * 1000) / 1000).toString()}</b></div>`;
      techSummaryEl.innerHTML = chip('', 'Neutral', m.neutral) + chip('own', 'Own', m.own) + chip('enemy', 'Enemy', m.enemy);
    }
  };

  const setMyTeam = (key) => {
    myTeam = key;
    localStorage.setItem('myTeam', myTeam);
    updateEnergyUI();
    renderStrongholds();
    refreshEnergy();
  };

  const onTechInput = () => {
    for (const key of Object.keys(techEls)) {
      if (techEls[key]) techs[key] = clampPct(techEls[key].value);
    }
    localStorage.setItem('hexTechs', JSON.stringify(techs));
    updateEnergyUI();
    refreshEnergy();
  };

  for (const el of Object.values(techEls)) {
    if (!el) continue;
    el.addEventListener('input', onTechInput);
    el.addEventListener('blur', () => {
      el.value = String(clampPct(el.value));
      onTechInput();
    });
  }

  if (perMoveEl) {
    const apply = () => {
      perMove = clampMove(perMoveEl.value);
      localStorage.setItem('hexPerMove', String(perMove));
      updateEnergyUI();
      refreshEnergy();
    };
    perMoveEl.addEventListener('change', apply);
    perMoveEl.addEventListener('blur', () => {
      perMoveEl.value = String(clampMove(perMoveEl.value));
      apply();
    });
  }

  const territoryTag = (cell) => {
    const owner = lastTerritory.get(cell) ? lastTerritory.get(cell).team : null;
    return Conquest.territoryKind(owner, myTeam);
  };

  const renderPathUI = () => {
    if (pathFromEl && document.activeElement !== pathFromEl) pathFromEl.value = pathStart;
    if (pathToEl && document.activeElement !== pathToEl) pathToEl.value = pathEnd;

    // which box the next map click fills
    if (pathFromEl) pathFromEl.classList.toggle('picking', !pathStart || (!!pathStart && !!pathEnd));
    if (pathToEl) pathToEl.classList.toggle('picking', !!pathStart && !pathEnd);
    if (pathShBtn) pathShBtn.classList.toggle('active', pathStart === SH);

    const tiles = pathTileCount();
    const moves = Math.ceil(tiles / perMove);

    // floating summary above the map
    if (pathBannerEl) {
      if (pathResult && pathResult.ok) {
        pathBannerEl.hidden = false;
        pathBannerEl.innerHTML = `<span>${pathStart} \u2192 ${pathEnd}</span><span class="big">${fmt(pathResult.total)} energy</span><span class="muted">${tiles} tiles \u00b7 ${moves} move${moves === 1 ? '' : 's'}</span><button type="button" id="banner-clear">Clear</button>`;
        $('banner-clear').addEventListener('click', clearPath);
      } else {
        pathBannerEl.hidden = true;
        pathBannerEl.innerHTML = '';
      }
    }

    if (!pathResultEl) return;
    pathResultEl.replaceChildren();

    if (!pathStart || !pathEnd) return;

    if (!pathResult || !pathResult.ok) {
      const d = document.createElement('div');
      d.className = 'path-hint bad';
      d.textContent = pathResult ? pathResult.reason : 'No route.';
      pathResultEl.appendChild(d);
      return;
    }

    const total = document.createElement('div');
    total.className = 'path-total';
    total.innerHTML = `<span class="big">${fmt(pathResult.total)}</span><span class="unit">energy</span><span class="moves">${tiles} tiles \u00b7 ${moves} move${moves === 1 ? '' : 's'}</span>`;
    pathResultEl.appendChild(total);

    // tiles entered, in order, grouped into moves
    const entered = pathResult.cells
      .map((cell, i) => ({ cell, cost: pathResult.costs[i] }))
      .filter((s, i) => pathResult.fromStronghold || i > 0);

    const list = document.createElement('div');
    list.className = 'path-steps';

    for (let g = 0; g * perMove < entered.length; g++) {
      const chunk = entered.slice(g * perMove, (g + 1) * perMove);
      const sum = chunk.reduce((a, s) => a + s.cost, 0);

      const head = document.createElement('div');
      head.className = 'move-head';
      head.innerHTML = `<span class="move-n">${g + 1}</span><span>Move ${g + 1}</span><span class="move-meta">${chunk.length} tile${chunk.length === 1 ? '' : 's'}</span><b>${fmt(sum)}</b>`;
      head.addEventListener('click', () => locateCell(chunk[chunk.length - 1].cell));
      list.appendChild(head);

      chunk.forEach((s, k) => {
        const tile = tileAt(s.cell);
        const base = tile ? Number(tile.cost) || 0 : 0;
        const kind = territoryTag(s.cell);

        const row = document.createElement('div');
        row.className = `step ${kind}`;
        row.title = kind === 'own' ? 'Your territory' : kind === 'enemy' ? 'Enemy territory' : 'Neutral';
        row.innerHTML = `<span class="step-n">${g * perMove + k + 1}</span><span class="step-cell">${s.cell}</span><span class="step-tile">${tile ? tile.name : ''}</span><span class="step-cost">${s.cost !== base ? `<s>${fmt(base)}</s>` : ''}${fmt(s.cost)}</span>`;
        row.addEventListener('click', () => locateCell(s.cell));
        list.appendChild(row);
      });
    }

    pathResultEl.appendChild(list);
  };

  const showPathError = (text) => {
    if (!pathResultEl) return;
    const d = document.createElement('div');
    d.className = 'path-hint bad';
    d.textContent = text;
    pathResultEl.prepend(d);
  };

  const setPathPoint = (which, text) => {
    const raw = String(text || '').trim();

    if (!raw) {
      if (which === 'start') pathStart = '';
      else pathEnd = '';
    } else {
      const pos = Conquest.normalizePosition(raw);
      const okStart = which === 'start' && pos === SH;
      if (!pos || (pos === SH && !okStart) || (pos !== SH && !isPlayableCell(pos))) {
        refreshEnergy();
        showPathError(`${raw.toUpperCase()} is not on the map.`);
        return;
      }
      if (which === 'start') pathStart = pos;
      else pathEnd = pos;
    }

    refreshEnergy();
  };

  const clearPath = () => {
    pathStart = '';
    pathEnd = '';
    refreshEnergy();
  };

  const handlePathClick = (cell) => {
    // first click = A, second = B, a third starts over
    if (!pathStart || (pathStart && pathEnd)) {
      pathStart = cell;
      pathEnd = '';
    } else {
      pathEnd = cell;
    }
    refreshEnergy();
  };

  if (pathFromEl) {
    pathFromEl.addEventListener('change', () => setPathPoint('start', pathFromEl.value));
    pathFromEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') pathFromEl.blur(); });
  }
  if (pathToEl) {
    pathToEl.addEventListener('change', () => setPathPoint('end', pathToEl.value));
    pathToEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') pathToEl.blur(); });
  }
  if (pathShBtn) {
    pathShBtn.addEventListener('click', () => {
      pathStart = pathStart === SH ? '' : SH;
      refreshEnergy();
    });
  }
  $('path-clear')?.addEventListener('click', clearPath);

  // ---- hover readout (tile, terrain, energy for the team you play) ---------
  let hoverCell = '';
  let hoverRaf = 0;

  function renderHover() {
    if (!hoverEl) return;
    if (!hoverCell || !isPlayableCell(hoverCell)) {
      hoverEl.hidden = true;
      return;
    }

    const tile = tileAt(hoverCell);
    if (!tile) {
      hoverEl.hidden = true;
      return;
    }

    const owner = lastTerritory.get(hoverCell) ? lastTerritory.get(hoverCell).team : null;
    const eff = energyFor(hoverCell, lastTerritory);
    const dot = owner ? `<i style="background:${Conquest.TEAMS[owner].color}"></i>` : '';
    hoverEl.innerHTML = `<b>${hoverCell}</b><span>${tile.name}</span>${dot}<em>${eff === null ? 'impassable' : fmt(eff) + ' energy'}</em>`;
    hoverEl.hidden = false;
  }

  if (gridEl) {
    gridEl.addEventListener('mouseover', (e) => {
      const hex = e.target.closest?.('.hexagon');
      const cell = hex && hex.dataset.cell;
      if (!cell || cell === hoverCell) return;
      hoverCell = cell;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        renderHover();
      });
    });

    gridEl.addEventListener('mouseleave', () => {
      hoverCell = '';
      renderHover();
    });
  }

  // ---- everything that depends on pieces -----------------------------------
  const renderAll = () => {
    refreshEnergy();
    renderOverview();
    renderStrongholds();
    updateEnergyUI();
    savePieces();
  };

  // ---- history (shares the Undo / Redo buttons with terrain painting) ------
  const commitPieces = (mutate) => {
    const before = clonePieces(pieces);
    mutate();
    pieces = sanitizePieces(pieces);
    const after = clonePieces(pieces);

    if (JSON.stringify(before) === JSON.stringify(after)) {
      renderAll();
      return false;
    }

    undoStack.push({ pieces: { before, after } });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoUI();

    renderAll();
    return true;
  };

  const setPieces = (arr) => {
    pieces = sanitizePieces(arr);
    renderAll();
  };

  // ---- placing pieces on the map -------------------------------------------
  const placeTowerAt = (cell) => {
    const note = Conquest.cleanNote(pieceNameEl ? pieceNameEl.value : '');

    commitPieces(() => {
      const existing = pieces.find((p) => p.type === 'tower' && p.cell === cell);
      if (existing) {
        existing.team = toolTeam;
        existing.level = toolLevel;
        if (note) existing.note = note;
      } else {
        pieces.push({ id: newId(), type: 'tower', team: toolTeam, level: toolLevel, note, cell });
      }
    });

    if (pieceNameEl) pieceNameEl.value = '';
  };

  const erasePieceAt = (cell) => {
    const here = pieces.filter((p) => p.cell === cell);
    if (!here.length) return;
    const victim = here[here.length - 1]; // the one added last
    commitPieces(() => { pieces = pieces.filter((p) => p.id !== victim.id); });
  };

  let lastClick = { key: '', t: 0 };

  // Returns true when the click was consumed (anything but painting terrain).
  const handleMapClick = (cell) => {
    const mode = activeMode();
    if (mode === 'terrain') return false;

    const now = Date.now();
    const key = `${mode}:${cell}`;
    if (key === lastClick.key && now - lastClick.t < 350) return true;
    lastClick = { key, t: now };

    if (mode === 'none' || !isPlayableCell(cell)) return true;

    if (mode === 'tower') placeTowerAt(cell);
    else if (mode === 'erase') erasePieceAt(cell);
    else if (mode === 'path') handlePathClick(cell);
    return true;
  };

  function locateCell(cell) {
    const hex = gridEl?.querySelector(`[data-cell='${cell}']`);
    if (!hex) return;

    hex.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    hex.classList.remove('locate');
    void hex.offsetWidth;
    hex.classList.add('locate');
    setTimeout(() => hex.classList.remove('locate'), 1700);
  }

  // ---- messages (Towers tab) ------------------------------------------------
  function showOvMsg(text) {
    if (ovMsgEl) ovMsgEl.textContent = text || '';
  }

  // ---- tools panel (Build tab) ---------------------------------------------
  const buildTeamPicker = () => {
    if (teamPickerEl) {
      teamPickerEl.replaceChildren();
      for (const key of Conquest.CORNER_ORDER) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'team-btn';
        b.dataset.team = key;
        b.style.background = Conquest.TEAMS[key].color;
        b.title = `${Conquest.TEAMS[key].label} (${Conquest.TEAMS[key].cornerLabel})`;
        b.addEventListener('click', () => {
          toolTeam = key;
          localStorage.setItem('toolTeam', toolTeam);
          refreshToolUI();
        });
        teamPickerEl.appendChild(b);
      }
    }

  };

  const updateGridMode = () => {
    if (!gridEl) return;
    const mode = activeMode();
    gridEl.classList.toggle('mode-piece', mode === 'tower' || mode === 'path');
    gridEl.classList.toggle('mode-erase', mode === 'erase');
    gridEl.classList.toggle('mode-none', mode === 'none');
  };

  const refreshToolUI = () => {
    if (toolModesEl) {
      for (const b of toolModesEl.querySelectorAll('.seg-btn')) b.classList.toggle('active', b.dataset.mode === toolMode);
    }

    const piece = toolMode === 'tower';
    if (toolOptionsEl) toolOptionsEl.hidden = !piece;
    if (levelWrapEl) levelWrapEl.hidden = toolMode !== 'tower';
    if (nameWrapEl) nameWrapEl.hidden = !piece;
    if (pieceNameEl) pieceNameEl.maxLength = Conquest.MAX_NOTE;

    if (teamPickerEl) {
      for (const b of teamPickerEl.querySelectorAll('.team-btn')) b.classList.toggle('active', b.dataset.team === toolTeam);
    }

    if (levelPickerEl) {
      levelPickerEl.replaceChildren();
      for (let lvl = 0; lvl <= Conquest.MAX_LEVEL; lvl++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'level-btn' + (lvl === toolLevel ? ' active' : '');
        b.title = `Level ${lvl}`;
        b.innerHTML = `${Conquest.towerIcon(toolTeam, lvl, 66)}<span>Lv ${lvl}</span>`;
        b.addEventListener('click', () => {
          toolLevel = lvl;
          refreshToolUI();
        });
        levelPickerEl.appendChild(b);
      }
    }

    updateGridMode();
  };

  const setToolMode = (mode) => {
    toolMode = mode;
    refreshToolUI();
  };

  const setTab = (name) => {
    activeTab = name;
    if (tabsEl) {
      for (const b of tabsEl.querySelectorAll('.tab-btn')) b.classList.toggle('active', b.dataset.tab === name);
    }
    for (const pane of document.querySelectorAll('.tab-pane')) pane.hidden = pane.dataset.pane !== name;
    localStorage.setItem('hexTab', name);
    updateGridMode();
  };

  if (toolModesEl) {
    toolModesEl.addEventListener('click', (e) => {
      const b = e.target.closest?.('.seg-btn');
      if (b && b.dataset.mode) setToolMode(b.dataset.mode);
    });
  }

  if (tabsEl) {
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest?.('.tab-btn');
      if (b) setTab(b.dataset.tab);
    });
  }

  const bindToggle = (el, key) => {
    if (!el) return;
    el.checked = !!viewPrefs[key];
    el.addEventListener('change', () => {
      viewPrefs[key] = el.checked;
      saveViewPrefs();
      renderOverlays();
    });
  };
  bindToggle(showTerritoryEl, 'territory');
  bindToggle(showNamesEl, 'names');
  bindToggle(showCostsEl, 'costs');

  buildTeamPicker();
  buildCompass();
  refreshToolUI();
  updateEnergyUI();
  {
    const savedTab = localStorage.getItem('hexTab');
    setTab(['build', 'towers', 'energy', 'share'].includes(savedTab) ? savedTab : 'build');
  }

 
  buildPaletteThemeMenu();
  updatePaletteThemeUI();
  buildPalette();

  if (centerEl) centerEl.textContent = findCenter(endWidth, endHeight);

  rebuildGridDOM();

  updateUndoRedoUI();

  
  const getCellFromEvent = (e) => {
    const hex = e.target.closest?.('.hexagon');
    if (!hex || !hex.dataset || !hex.dataset.cell) return null;
    return hex.dataset.cell;
  };

  if (gridEl) {
    gridEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const cellIndex = getCellFromEvent(e);
      if (!cellIndex) return;

      // Tower tool, erase, path picking: act on the tile instead of painting.
      // Touch is handled by the touchstart listener below.
      if (activeMode() !== 'terrain') {
        if (e.pointerType !== 'touch') handleMapClick(cellIndex);
        return;
      }

      isPainting = true;
      lastCell = cellIndex;

      strokeBefore = new Map();
      strokeAfter = new Map();

      gridEl.setPointerCapture?.(e.pointerId);
      applyPaintToCell(cellIndex);
    });

    gridEl.addEventListener('pointermove', (e) => {
      if (!isPainting) return;
      const cellIndex = getCellFromEvent(e);
      if (!cellIndex || cellIndex === lastCell) return;
      lastCell = cellIndex;
      applyPaintToCell(cellIndex);
    });

    const endStroke = () => {
      if (!isPainting) return;
      isPainting = false;
      lastCell = null;

      if (strokeBefore && strokeAfter) pushHistory(strokeBefore, strokeAfter);
      strokeBefore = null;
      strokeAfter = null;
    };

    gridEl.addEventListener('pointerup', endStroke);
    gridEl.addEventListener('pointercancel', endStroke);
  }
  if (gridEl) {
    const touchToCell = (touch) => {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const hex = el?.closest?.('.hexagon');
      return hex?.dataset?.cell || null;
    };

    let touchPainting = false;

    gridEl.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;

      // 2 fingers = let the browser handle pan/zoom
      if (e.touches.length >= 2) {
        touchPainting = false;
        lastCell = null;
        strokeBefore = null;
        strokeAfter = null;
        return;
      }

      const cell = touchToCell(e.touches[0]);
      if (!cell) return;

      e.preventDefault();

      if (activeMode() !== 'terrain') {
        handleMapClick(cell);
        return;
      }

      touchPainting = true;
      lastCell = cell;

      strokeBefore = new Map();
      strokeAfter = new Map();

      applyPaintToCell(cell);
    }, { passive: false });

    gridEl.addEventListener('touchmove', (e) => {
      // 2 fingers = stop painting and let browser pan/zoom
      if (e.touches && e.touches.length >= 2) {
        if (touchPainting) {
          touchPainting = false;

          if (strokeBefore && strokeAfter) pushHistory(strokeBefore, strokeAfter);
          strokeBefore = null;
          strokeAfter = null;
          lastCell = null;
        }
        return;
      }

      if (!touchPainting) return;
      if (!e.touches || !e.touches.length) return;

      const cell = touchToCell(e.touches[0]);
      if (!cell || cell === lastCell) return;

      e.preventDefault();

      lastCell = cell;
      applyPaintToCell(cell);
    }, { passive: false });

    const endTouchStroke = () => {
      if (!touchPainting) return;

      touchPainting = false;
      lastCell = null;

      if (strokeBefore && strokeAfter) pushHistory(strokeBefore, strokeAfter);
      strokeBefore = null;
      strokeAfter = null;
    };

    gridEl.addEventListener('touchend', endTouchStroke, { passive: true });
    gridEl.addEventListener('touchcancel', endTouchStroke, { passive: true });
  }
  
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrl = isMac ? e.metaKey : e.ctrlKey;

    if (!ctrl) return;

    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });

  
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      for (const k of Object.keys(gridColors)) delete gridColors[k];
      localStorage.removeItem('hexMap');
      localStorage.removeItem('selectedTile');
      localStorage.removeItem('fillColor');

      pieces = [];
      savePieces();

      undoStack.length = 0;
      redoStack.length = 0;
      updateUndoRedoUI();

      rebuildGridDOM();
    });
  }

  if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => openModal('export-json'));
  if (exportCodeBtn) exportCodeBtn.addEventListener('click', () => openModal('export-code'));
  if (importBtn) importBtn.addEventListener('click', () => openModal('import'));

  if (exportPngBtn) exportPngBtn.addEventListener('click', exportPNG);

  if (paletteThemeBtn && paletteThemeMenu) {
    paletteThemeBtn.addEventListener('click', () => togglePaletteThemeMenu());

    paletteThemeMenu.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.dropdown-item');
      if (!btn) return;
      const value = btn.dataset.value;
      if (!value) return;
      togglePaletteThemeMenu(false);
      setPaletteTheme(value);
    });

    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('palette-theme-dropdown');
      if (!wrap) return;
      if (!wrap.contains(e.target)) togglePaletteThemeMenu(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') togglePaletteThemeMenu(false);
    });
  }

  const closeTargets = [modalClose, modalSecondary, modal?.querySelector?.('.modal-backdrop')].filter(Boolean);
  closeTargets.forEach((el) => el.addEventListener('click', closeModal));

  if (modalPrimary) {
    modalPrimary.addEventListener('click', async () => {
      if (!modalText) return;

      if (modalMode === 'import') {
        let obj = null;
        try {
          obj = parseImportText(modalText.value);
        } catch {
          if (modalHint) modalHint.textContent = 'Invalid import format.';
          return;
        }

        const ok = applyImportPayload(obj);
        if (!ok) {
          if (modalHint) modalHint.textContent = 'Invalid import data.';
          return;
        }

        
        updatePaletteThemeUI();
        buildPalette();

        undoStack.length = 0;
        redoStack.length = 0;
        updateUndoRedoUI();

        rebuildGridDOM();

        localStorage.setItem('hexMap', JSON.stringify(gridColors));
        closeModal();
        return;
      }

      
      try {
        await navigator.clipboard.writeText(modalText.value);
        if (modalHint) modalHint.textContent = 'Copied.';
        setTimeout(() => closeModal(), 350);
      } catch {
        modalText.focus();
        modalText.select();
        if (modalHint) modalHint.textContent = 'Copy failed. Copy manually.';
      }
    });
  }

};
