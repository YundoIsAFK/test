'use strict';

/*
 * Conquest overlay for the map maker: watchtowers, pawns (players),
 * team territory and the alliance stronghold.
 *
 * This file has no DOM code. It holds the rules (teams, radius per tower
 * level, hex geometry) and the SVG artwork, and exposes them as `Conquest`.
 * hex_map.js does the wiring (clicks, overview panel, saving).
 */
const Conquest = (() => {
  // ==========================================================================
  //  SETTINGS YOU MAY WANT TO TWEAK
  // ==========================================================================

  // How many hexes out a watchtower claims, by level (index = level).
  // Level 0 claims only the hex it stands on. The other numbers are my
  // placeholders: change them here to match the real game.
  const TOWER_RADIUS = [0, 1, 2, 3, 4];

  // A hero moves this many tiles per move (the Energy tab can override it).
  const TILES_PER_MOVE = 4;

  // The first tile each team can take from its stronghold: the corner hex
  // on its side of the map. Change these if the game uses different tiles.
  const STRONGHOLD_ENTRY = { yellow: 'A1', green: 'AS1', blue: 'A45', red: 'AS45' };

  const MAX_NAME = 24;
  const MAX_NOTE = 80;

  const TEAMS = {
    red:    { label: 'Red',    color: '#e53935', corner: 'se', cornerLabel: 'South East' },
    yellow: { label: 'Yellow', color: '#fdd835', corner: 'nw', cornerLabel: 'North West' },
    green:  { label: 'Green',  color: '#3fbf4a', corner: 'ne', cornerLabel: 'North East' },
    blue:   { label: 'Blue',   color: '#2f6bff', corner: 'sw', cornerLabel: 'South West' }
  };

  // Teams in map order: north-west, north-east, south-west, south-east.
  const CORNER_ORDER = ['yellow', 'green', 'blue', 'red'];

  // Energy rules. Moving inside your own alliance's territory costs half,
  // inside an enemy's territory double. Your techs then reduce the result.
  const OWN_TERRITORY_MULT = 0.5;
  const ENEMY_TERRITORY_MULT = 2;

  // ==========================================================================

  const TEAM_KEYS = Object.keys(TEAMS);
  const MAX_LEVEL = TOWER_RADIUS.length - 1;
  const STRONGHOLD = 'SH'; // a pawn "position" meaning stationed in the alliance stronghold

  // ---- cell ids (same scheme as the map: A1, B12, AS46 ...) ----------------
  const fromAlpha = (s) => s.split('').reduce((r, a) => r * 26 + parseInt(a, 36) - 9, 0) - 1;

  const toAlpha = (n) => {
    let result = '';
    do {
      result = (n % 26 + 10).toString(36) + result;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return result.toUpperCase();
  };

  const parseCell = (id) => {
    const m = /^([A-Z]+)(\d+)$/.exec(String(id || ''));
    return m ? { col: fromAlpha(m[1]), row: parseInt(m[2], 10) } : null;
  };

  const cellId = (col, row) => toAlpha(col) + row;

  // What a person types for a position: "d32", " D 32 ", "sh", "stronghold".
  const normalizePosition = (str) => {
    const s = String(str || '').toUpperCase().replace(/\s+/g, '');
    if (!s) return null;
    if (s === 'SH' || s === 'STRONGHOLD' || s === 'STATIONED') return STRONGHOLD;
    return /^[A-Z]+\d+$/.test(s) ? s : null;
  };

  const cleanName = (str) => String(str || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const cleanNote = (str) => String(str || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

  // ---- hex geometry --------------------------------------------------------
  // The map has flat-topped hexes; even columns (A, C, E ...) sit half a hex
  // lower than odd columns. Each hex is drawn in a 120 x 104 box.
  const HEX_W = 120;
  const HEX_H = 104;

  const toCube = (col, row) => {
    const x = col;
    const z = row - (col + (col & 1)) / 2;
    return { x, y: -x - z, z };
  };

  const hexDistance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

  // Neighbour offsets [dcol, drow] for the six sides, in this order:
  // top, upper-right, lower-right, bottom, lower-left, upper-left.
  const neighborOffsets = (col) => (col % 2 === 0
    ? [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
    : [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]);

  // Corner points of the hex box, in the same side order as above.
  const CORNERS = [[30, 0], [90, 0], [120, 52], [90, 104], [30, 104], [0, 52]];

  // Middle of each side, same order; used to draw a path from hex to hex.
  const SIDE_MID = [[60, 0], [105, 26], [105, 78], [60, 104], [15, 78], [15, 26]];

  const radiusFor = (level) => TOWER_RADIUS[Math.min(Math.max(Math.round(Number(level)) || 0, 0), MAX_LEVEL)];

  // Which cell each tower claims. Where towers overlap, the HIGHEST LEVEL wins
  // and, at equal level, the tower BUILT FIRST (lowest id). A tower's own hex
  // always stays with its owner, even if a stronger tower covers it.
  const computeTerritory = (towers, inBounds) => {
    const best = new Map();

    const beats = (t, cur) =>
      t.level > cur.level || (t.level === cur.level && t.id < cur.tower);

    for (const t of towers) {
      const p = parseCell(t.cell);
      if (!p) continue;

      const R = radiusFor(t.level);
      const center = toCube(p.col, p.row);

      for (let col = p.col - R; col <= p.col + R; col++) {
        if (col < 0) continue;
        for (let row = p.row - 2 * R - 1; row <= p.row + 2 * R + 1; row++) {
          if (!inBounds(col, row)) continue;

          const d = hexDistance(center, toCube(col, row));
          if (d > R) continue;

          const id = cellId(col, row);
          const cur = best.get(id);
          if (!cur || beats(t, cur)) best.set(id, { team: t.team, dist: d, level: t.level, tower: t.id });
        }
      }
    }

    for (const t of towers) {
      const p = parseCell(t.cell);
      if (p && inBounds(p.col, p.row)) best.set(t.cell, { team: t.team, dist: 0, level: t.level, tower: t.id });
    }

    return best;
  };

  // ---- energy -------------------------------------------------------------
  const pct = (v) => Math.min(Math.max(Number(v) || 0, 0), 100) / 100;

  // Energy to step onto a tile, always a whole number (rounded to nearest). `owner` is the team whose territory it is
  // (or null), `myTeam` is the team you play as ('' = not chosen), and
  // `techs` = { general, alliance, enemy } in percent.
  const effectiveCost = (base, owner, myTeam, techs) => {
    let cost = base * (1 - pct(techs.general));
    if (myTeam && owner) {
      if (owner === myTeam) cost *= OWN_TERRITORY_MULT * (1 - pct(techs.alliance));
      else cost *= ENEMY_TERRITORY_MULT * (1 - pct(techs.enemy));
    }
    return Math.round(cost);
  };

  const territoryKind = (owner, myTeam) => (!owner || !myTeam ? 'neutral' : owner === myTeam ? 'own' : 'enemy');

  const multipliers = (techs) => ({
    neutral: 1 - pct(techs.general),
    own: OWN_TERRITORY_MULT * (1 - pct(techs.general)) * (1 - pct(techs.alliance)),
    enemy: ENEMY_TERRITORY_MULT * (1 - pct(techs.general)) * (1 - pct(techs.enemy))
  });

  // ---- path finding ---------------------------------------------------------
  // Cheapest route in energy from one hex to another (Dijkstra). `costAt(col,
  // row)` returns the energy to step onto that hex, or null if it can't be
  // entered. Equal-energy routes prefer fewer moves. The start hex is free.
  const findPath = (start, goal, costAt, opts = {}) => {
    // opts.entry: begin in the stronghold and enter this hex first (it costs energy).
    const s = parseCell(opts.entry || start);
    const g = parseCell(goal);
    if (!s || !g) return { ok: false, reason: 'Both tiles need a valid position.' };

    if (costAt(g.col, g.row) === null) {
      return { ok: false, reason: 'The destination can\u2019t be entered (water, mountains or off the map).' };
    }

    const startId = cellId(s.col, s.row);
    const goalId = cellId(g.col, g.row);

    let first = 0;
    if (opts.entry) {
      first = costAt(s.col, s.row);
      if (first === null) return { ok: false, reason: 'The stronghold\u2019s corner tile can\u2019t be entered.' };
    }

    if (startId === goalId) return { ok: true, cells: [startId], costs: [first], total: first, fromStronghold: !!opts.entry };

    const EPS = 1e-9;
    const best = new Map([[startId, { cost: first, steps: opts.entry ? 1 : 0 }]]);
    const prev = new Map();
    const done = new Set();

    const heap = [];
    const less = (a, b) => a[0] < b[0] - EPS || (Math.abs(a[0] - b[0]) <= EPS && a[1] < b[1]);
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!less(heap[i], heap[parent])) break;
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };

    push([first, opts.entry ? 1 : 0, s.col, s.row]);

    while (heap.length) {
      const [cost, steps, col, row] = pop();
      const id = cellId(col, row);
      if (done.has(id)) continue;
      done.add(id);
      if (id === goalId) break;

      for (const [dc, dr] of neighborOffsets(col)) {
        const nc = col + dc;
        const nr = row + dr;
        const step = costAt(nc, nr);
        if (step === null) continue;

        const nid = cellId(nc, nr);
        if (done.has(nid)) continue;

        const nCost = cost + step;
        const nSteps = steps + 1;
        const cur = best.get(nid);
        if (!cur || nCost < cur.cost - EPS || (Math.abs(nCost - cur.cost) <= EPS && nSteps < cur.steps)) {
          best.set(nid, { cost: nCost, steps: nSteps });
          prev.set(nid, id);
          push([nCost, nSteps, nc, nr]);
        }
      }
    }

    if (!done.has(goalId)) return { ok: false, reason: 'No route: impassable tiles block every way there.' };

    const cells = [goalId];
    while (cells[0] !== startId) cells.unshift(prev.get(cells[0]));

    const costs = cells.map((c, i) => (i === 0 ? first : best.get(c).cost - best.get(cells[i - 1]).cost));
    return { ok: true, cells, costs, total: best.get(goalId).cost, fromStronghold: !!opts.entry };
  };

  // Which side of hex `a` touches hex `b` (0 top ... 5 upper-left), or -1.
  const sideBetween = (a, b) => {
    const pa = parseCell(a);
    const pb = parseCell(b);
    if (!pa || !pb) return -1;
    const offs = neighborOffsets(pa.col);
    for (let i = 0; i < 6; i++) {
      if (pa.col + offs[i][0] === pb.col && pa.row + offs[i][1] === pb.row) return i;
    }
    return -1;
  };

  // Per-hex info for drawing a route. A route is cut into moves of
  // `perMove` tiles; the last tile of each move gets its move number.
  // `fromStronghold` means the first tile is entered too (it counts as a tile).
  const pathInfoMap = (cells, opts = {}) => {
    const perMove = Math.max(1, Math.round(opts.perMove) || TILES_PER_MOVE);
    const skip = opts.fromStronghold ? 0 : 1; // the start hex isn't "entered" otherwise
    const total = cells.length - skip;
    const m = new Map();

    cells.forEach((c, i) => {
      const step = i - skip + 1; // 1-based count of tiles entered
      const endsMove = step >= 1 && (step % perMove === 0 || step === total);
      m.set(c, {
        index: i,
        isStart: i === 0,
        isEnd: i === cells.length - 1,
        prevSide: i > 0 ? sideBetween(c, cells[i - 1]) : -1,
        nextSide: i < cells.length - 1 ? sideBetween(c, cells[i + 1]) : -1,
        moveEnd: endsMove ? Math.ceil(step / perMove) : 0
      });
    });
    return m;
  };

  // ---- saved data ----------------------------------------------------------
  // Cleans a list of pieces (from storage or an import) into a safe shape.
  const normalizePieces = (arr) => {
    const out = [];
    const usedIds = new Set();
    const towerCells = new Set();

    for (const raw of Array.isArray(arr) ? arr : []) {
      if (!raw || typeof raw !== 'object') continue;

      const type = raw.type === 'tower' ? 'tower' : raw.type === 'pawn' ? 'pawn' : null;
      if (!type) continue;
      if (!TEAMS[raw.team]) continue;

      const pos = normalizePosition(raw.cell);
      if (!pos) continue;
      if (pos === STRONGHOLD && type !== 'pawn') continue;

      if (type === 'tower') {
        if (towerCells.has(pos)) continue;
        towerCells.add(pos);
      }

      let id = Number(raw.id);
      if (!Number.isInteger(id) || id < 1 || usedIds.has(id)) id = 0;
      if (id) usedIds.add(id);

      const piece = { id, type, team: raw.team, cell: pos };
      if (type === 'tower') {
        const lvl = Number.parseInt(raw.level, 10);
        piece.level = Number.isFinite(lvl) ? Math.min(Math.max(lvl, 0), MAX_LEVEL) : 1;
        piece.note = cleanNote(raw.note);
      } else {
        piece.name = cleanName(raw.name);
      }
      out.push(piece);
    }

    let next = Math.max(0, ...usedIds) + 1;
    for (const p of out) if (!p.id) p.id = next++;

    return out;
  };

  // ---- artwork -------------------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // amt > 0 lightens, amt < 0 darkens
  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16;
    let g = (n >> 8) & 255;
    let b = n & 255;
    const target = amt < 0 ? 0 : 255;
    const a = Math.abs(amt);
    r = Math.round(r + (target - r) * a);
    g = Math.round(g + (target - g) * a);
    b = Math.round(b + (target - b) * a);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  const diamond = (x, y, s, fill, stroke) =>
    `<path d="M${x} ${y - s} L${x + s * 0.7} ${y} L${x} ${y + s} L${x - s * 0.7} ${y} Z" fill="${fill}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/>`;

  const arch = (x, y) =>
    `<path d="M${x} ${y + 8} L${x} ${y + 3} Q${x + 3} ${y - 1} ${x + 6} ${y + 3} L${x + 6} ${y + 8} Z" fill="#1d1d1d"/>`;

  // A watchtower in a 60 x 100 box. Level changes the build, like the game:
  // 1 = wooden, 2 = stone top with eyes on the roof, 3 = all stone with gold,
  // 4 = same with extra gold spikes.
  // Level 0: a small wooden outpost with a flag.
  const outpostInner = (team) => {
    const c = TEAMS[team].color;
    const cd = shade(c, -0.4);
    const cl = shade(c, 0.4);
    let g = '';
    g += '<ellipse cx="30" cy="97" rx="24" ry="4" fill="rgba(0,0,0,0.28)"/>';
    g += '<path d="M10 96 L50 96 L46 84 L14 84 Z" fill="#7c8793" stroke="#505a64" stroke-width="1.5" stroke-linejoin="round"/>';
    g += '<path d="M16 84 L44 84 L42 62 L18 62 Z" fill="#8a4a2a" stroke="#5a2d17" stroke-width="1.5" stroke-linejoin="round"/>';
    g += '<path d="M26 84 L26 75 Q30 70 34 75 L34 84 Z" fill="#5a2d17"/>';
    g += '<rect x="36" y="67" width="4.5" height="6" fill="#1d1d1d"/>';
    g += '<path d="M30 44 L30 12" stroke="#5a2d17" stroke-width="2.4" stroke-linecap="round"/>';
    g += `<path d="M30 12 L50 19 L30 27 Z" fill="${c}" stroke="${cd}" stroke-width="1.3" stroke-linejoin="round"/>`;
    g += `<path d="M11 64 L30 40 L49 64 Z" fill="${c}" stroke="${cd}" stroke-width="1.5" stroke-linejoin="round"/>`;
    g += `<path d="M30 42 L16 63 L24 63 Z" fill="${cl}" opacity="0.5"/>`;
    return g;
  };

  const towerInner = (team, level) => {
    if (level === 0) return outpostInner(team);
    const c = TEAMS[team].color;
    const cd = shade(c, -0.4);
    const cl = shade(c, 0.4);
    const wood = '#8a4a2a';
    const woodD = '#5a2d17';
    const stone = '#93a89d';
    const stoneD = '#5f7268';
    const foot = '#7c8793';
    const footD = '#505a64';
    const gold = '#ffc928';
    const goldD = '#a87700';
    const silver = '#d6e6f3';

    const lowerFill = level >= 3 ? stone : wood;
    const lowerStroke = level >= 3 ? stoneD : woodD;
    const upperFill = level >= 2 ? stone : wood;
    const upperStroke = level >= 2 ? stoneD : woodD;

    let g = '';
    g += '<ellipse cx="30" cy="97" rx="27" ry="4" fill="rgba(0,0,0,0.28)"/>';
    g += `<path d="M5 96 L55 96 L50 78 L10 78 Z" fill="${foot}" stroke="${footD}" stroke-width="1.5" stroke-linejoin="round"/>`;
    g += `<path d="M37 96 L51 96 L47.5 84 L41 84 Z" fill="${footD}" opacity="0.45"/>`;
    g += `<path d="M12 78 L48 78 L45.5 58 L14.5 58 Z" fill="${lowerFill}" stroke="${lowerStroke}" stroke-width="1.5" stroke-linejoin="round"/>`;
    g += `<path d="M14.5 58 L45.5 58 L43 38 L17 38 Z" fill="${upperFill}" stroke="${upperStroke}" stroke-width="1.5" stroke-linejoin="round"/>`;
    g += `<path d="M25.5 78 L25.5 69 Q30 63 34.5 69 L34.5 78 Z" fill="${level >= 3 ? stoneD : woodD}"/>`;

    g += arch(20, 41) + arch(34, 41);
    if (level >= 3) g += arch(20, 51) + arch(34, 51);

    // roof
    g += `<path d="M4 45 Q22 42 26 28 L30 5 L34 28 Q38 42 56 45 Q44 51 30 51 Q16 51 4 45 Z" fill="${c}" stroke="${cd}" stroke-width="1.5" stroke-linejoin="round"/>`;
    g += `<path d="M30 7 L26 28 Q22 40 10 44 Q22 36 30 7 Z" fill="${cl}" opacity="0.5"/>`;

    if (level >= 2) {
      g += '<ellipse cx="21" cy="40" rx="4.2" ry="3" fill="#f4efe0" stroke="#3a2a1a" stroke-width="0.9"/>';
      g += '<ellipse cx="39" cy="40" rx="4.2" ry="3" fill="#f4efe0" stroke="#3a2a1a" stroke-width="0.9"/>';
      g += '<circle cx="21" cy="40" r="1.4" fill="#111"/><circle cx="39" cy="40" r="1.4" fill="#111"/>';
    }

    // tip of the spire
    const tipFill = level >= 3 ? gold : silver;
    const tipStroke = level >= 3 ? goldD : '#7d93a3';
    g += `<path d="M30 0 L33.5 13 L26.5 13 Z" fill="${tipFill}" stroke="${tipStroke}" stroke-width="0.8" stroke-linejoin="round"/>`;

    if (level >= 3) {
      g += diamond(4, 45, 5, gold, goldD) + diamond(56, 45, 5, gold, goldD) + diamond(30, 52, 4, gold, goldD);
    }
    if (level >= 4) {
      g += diamond(15, 36, 4.5, gold, goldD) + diamond(45, 36, 4.5, gold, goldD) + diamond(30, 20, 4, gold, goldD);
    }

    return g;
  };

  const levelBadge = (level, cx, cy) =>
    `<circle cx="${cx}" cy="${cy}" r="8" fill="#1d1d1d" stroke="#ffc928" stroke-width="1.6"/>` +
    `<text x="${cx}" y="${cy + 3.8}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="#ffffff">${level}</text>`;

  // A player pawn in a 40 x 64 box: a little bell with a face and a crown.
  const pawnInner = (team) => {
    const c = TEAMS[team].color;
    const cd = shade(c, -0.4);
    const cl = shade(c, 0.4);

    let g = '';
    g += '<ellipse cx="20" cy="62" rx="16" ry="3" fill="rgba(0,0,0,0.3)"/>';
    g += `<path d="M20 31 C9 34 5 51 3 61 L37 61 C35 51 31 34 20 31 Z" fill="${c}" stroke="${cd}" stroke-width="1.5" stroke-linejoin="round"/>`;
    g += `<path d="M12 40 C11 47 9 53 8 59 L14 59 C14 52 15 46 17 38 Z" fill="${cl}" opacity="0.45"/>`;
    g += `<circle cx="20" cy="22" r="12" fill="${cl}" stroke="${cd}" stroke-width="1.5"/>`;
    g += '<circle cx="15.5" cy="21" r="1.8" fill="#222"/><circle cx="24.5" cy="21" r="1.8" fill="#222"/>';
    g += '<path d="M14.5 26.5 Q20 31 25.5 26.5" fill="none" stroke="#222" stroke-width="1.6" stroke-linecap="round"/>';
    g += '<path d="M12 11 L12.5 2 L16.5 6.5 L20 0 L23.5 6.5 L27.5 2 L28 11 Z" fill="#ffd54f" stroke="#b8860b" stroke-width="1" stroke-linejoin="round"/>';
    return g;
  };

  // The alliance stronghold: a walled town with red-roofed (team coloured) turrets.
  const strongholdSVG = (team, width = 72) => {
    const c = TEAMS[team].color;
    const cd = shade(c, -0.4);
    const turret = (ex, ey) =>
      `<rect x="${(ex - 4).toFixed(1)}" y="${(ey - 9).toFixed(1)}" width="8" height="11" fill="#7d8996" stroke="#4d5762" stroke-width="1"/>` +
      `<path d="M${(ex - 6).toFixed(1)} ${(ey - 8).toFixed(1)} L${ex.toFixed(1)} ${(ey - 20).toFixed(1)} L${(ex + 6).toFixed(1)} ${(ey - 8).toFixed(1)} Z" fill="${c}" stroke="${cd}" stroke-width="1" stroke-linejoin="round"/>`;

    const spots = [];
    for (let i = 0; i < 9; i++) {
      const a = (Math.PI * 2 * i) / 9 + 0.3;
      spots.push([48 + 40 * Math.cos(a), 46 + 17 * Math.sin(a)]);
    }
    spots.sort((p, q) => p[1] - q[1]);

    let g = '';
    g += '<ellipse cx="48" cy="48" rx="44" ry="20" fill="#5f6c78" stroke="#3e4852" stroke-width="2"/>';
    g += '<ellipse cx="48" cy="45" rx="34" ry="14" fill="#5b9a3e"/>';
    g += '<ellipse cx="44" cy="46" rx="9" ry="4" fill="#8a6b3f" opacity="0.8"/>';
    for (const [ex, ey] of spots) if (ey < 46) g += turret(ex, ey);
    g += '<rect x="40" y="24" width="16" height="22" fill="#8a96a3" stroke="#4d5762" stroke-width="1"/>';
    g += `<path d="M35 26 L48 6 L61 26 Z" fill="${c}" stroke="${cd}" stroke-width="1.2" stroke-linejoin="round"/>`;
    g += '<rect x="45" y="34" width="6" height="12" fill="#2a2f35"/>';
    for (const [ex, ey] of spots) if (ey >= 46) g += turret(ex, ey);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 70" width="${width}" height="${Math.round(width * 70 / 96)}">${g}</svg>`;
  };

  // 3D renders from sprites.js (a global); everything falls back to the vector art if missing.
  const sprite = (key) => (typeof SPRITES !== 'undefined' && SPRITES[key]) || null;

  const spriteImg = (key, ax, ay, k) => {
    const sp = sprite(key);
    if (!sp) return '';
    const x = ax - sp.ax * sp.w * k;
    const y = ay - sp.ay * sp.h * k;
    return `<image xlink:href="${sp.src}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(sp.w * k).toFixed(1)}" height="${(sp.h * k).toFixed(1)}"/>`;
  };

  const towerIcon = (team, level, height = 46) => {
    const sp = sprite(`tower_${team}_${level}`);
    if (sp) return `<img class="sprite-icon" alt="" src="${sp.src}" style="height:${height}px;width:auto">`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100" width="${Math.round(height * 0.6)}" height="${height}">${towerInner(team, level)}${levelBadge(level, 9, 70)}</svg>`;
  };

  const pawnIcon = (team, height = 40) => {
    const sp = sprite(`hero_${team}`);
    if (sp) return `<img class="sprite-icon" alt="" src="${sp.src}" style="height:${height}px;width:auto">`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 64" width="${Math.round(height * 40 / 64)}" height="${height}">${pawnInner(team)}</svg>`;
  };

  // ---- one hex's overlay ---------------------------------------------------
  // The overlay is drawn in two layers so 3D pieces always sit above every
  // territory tint:  base = territory fill, borders and the route line;
  // top = towers, heroes, markers, costs and labels. Pieces may rise above the
  // hex (like in the game), so the drawing area is larger than the hex.
  const OVERLAY_BOX = { x: -20, y: -60, w: 160, h: 170 };

  const wrapSVG = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${OVERLAY_BOX.x} ${OVERLAY_BOX.y} ${OVERLAY_BOX.w} ${OVERLAY_BOX.h}" width="${OVERLAY_BOX.w}" height="${OVERLAY_BOX.h}" style="position:absolute;left:${OVERLAY_BOX.x}px;top:${OVERLAY_BOX.y}px;overflow:visible">${inner}</svg>`;

  // Where pieces stand and how big they are drawn, in hex coordinates.
  const TOWER_K = 0.48;
  const HERO_K = 0.55;
  const HERO_BESIDE_TOWER_K = 0.50;

  const overlayLayers = (cell, territory, here, opts = {}) => {
    const own = territory.get(cell);
    const tower = here.find((p) => p.type === 'tower') || null;
    const pawns = here.filter((p) => p.type === 'pawn');
    const path = opts.path || null;
    const cost = opts.cost || null;
    if (!own && !tower && !pawns.length && !path && !cost) return { base: '', top: '' };

    let base = '';
    let top = '';

    if (own) {
      const color = TEAMS[own.team].color;
      base += `<polygon points="${CORNERS.map((p) => p.join(',')).join(' ')}" fill="${color}" fill-opacity="0.34"/>`;

      const pos = parseCell(cell);
      if (pos) {
        const offs = neighborOffsets(pos.col);
        const inset = (p) => [60 + (p[0] - 60) * 0.95, 52 + (p[1] - 52) * 0.95];
        let lines = '';
        for (let i = 0; i < 6; i++) {
          const nb = territory.get(cellId(pos.col + offs[i][0], pos.row + offs[i][1]));
          if (nb && nb.team === own.team) continue;
          const a = inset(CORNERS[i]);
          const b = inset(CORNERS[(i + 1) % 6]);
          lines += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
        }
        if (lines) base += `<g stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-opacity="0.95">${lines}</g>`;
      }
    }

    if (path) {
      const sides = [path.prevSide, path.nextSide].filter((x) => x >= 0);
      if (sides.length) {
        const d = sides.map((i) => `M60 52 L${SIDE_MID[i][0]} ${SIDE_MID[i][1]}`).join(' ');
        base += `<path d="${d}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="10" stroke-linecap="round"/>`;
        base += `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round"/>`;
      }
      if (!path.isStart && !path.isEnd) base += '<circle cx="60" cy="52" r="5.5" fill="#ffffff" stroke="#000" stroke-opacity="0.6" stroke-width="2"/>';
    }

    // ---- the pieces themselves (3D sprites, vector art if sprites.js is missing)
    const towerSpot = pawns.length ? [50, 70] : [60, 72];
    const heroSpot = tower ? [82, 92] : [60, 72];
    const heroK = tower ? HERO_BESIDE_TOWER_K : HERO_K;

    if (tower) {
      const img = spriteImg(`tower_${tower.team}_${tower.level}`, towerSpot[0], towerSpot[1], TOWER_K);
      if (img) {
        top += img;
        top += levelBadge(tower.level, towerSpot[0] - 32, towerSpot[1] - 4).replace('r="8"', 'r="7.5"');
      } else {
        const sc = pawns.length ? 0.7 : 0.82;
        const tx = pawns.length ? 8 : 60 - 30 * sc;
        const ty = pawns.length ? 16 : 10;
        top += `<g transform="translate(${tx.toFixed(1)} ${ty}) scale(${sc})">${towerInner(tower.team, tower.level)}${levelBadge(tower.level, 9, 70)}</g>`;
      }
    }

    if (pawns.length) {
      // One hero icon per tile; a number on it when several share the tile.
      const hero = pawns[0];
      const img = spriteImg(`hero_${hero.team}`, heroSpot[0], heroSpot[1], heroK);
      let bx;
      let by;
      if (img) {
        top += img;
        bx = heroSpot[0] + 26 * (heroK / 0.55);
        by = heroSpot[1] - 54 * (heroK / 0.55);
      } else {
        const hx = tower ? 68 : 41;
        const hy = tower ? 50 : 14;
        const sc = tower ? 0.6 : 0.95;
        top += `<g transform="translate(${hx} ${hy}) scale(${sc})">${pawnInner(hero.team)}</g>`;
        bx = hx + 38 * sc;
        by = hy + 10 * sc;
      }
      if (pawns.length > 1) top += levelBadge(pawns.length, Math.round(bx * 10) / 10, Math.round(by * 10) / 10);
    }

    if (path && (path.isStart || path.isEnd)) {
      const isA = path.isStart;
      top += `<circle cx="98" cy="24" r="10" fill="${isA ? '#2fcf7f' : '#ff5a5a'}" stroke="#ffffff" stroke-width="2.2"/>`;
      top += `<text x="98" y="28.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" fill="#ffffff">${isA ? 'A' : 'B'}</text>`;
    }

    if (path && path.moveEnd) {
      top += `<circle cx="22" cy="24" r="10" fill="#1d1d1d" stroke="#ffc928" stroke-width="2"/>`;
      top += `<text x="22" y="28.4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="800" fill="#ffffff">${path.moveEnd}</text>`;
    }

    if (cost) {
      const fill = cost.tone === 'down' ? '#9be7ff' : cost.tone === 'up' ? '#ffb199' : '#ffffff';
      top += `<text x="60" y="21" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="800" fill="${fill}" stroke="#000" stroke-opacity="0.85" stroke-width="3.4" stroke-linejoin="round" paint-order="stroke">${esc(cost.text)}</text>`;
    }

    if (opts.showNames) {
      let label = '';
      if (pawns.length === 1) label = pawns[0].name;
      else if (!pawns.length && tower) label = tower.note || '';

      if (label) {
        const shown = label.length > 13 ? label.slice(0, 12) + '…' : label;
        const w = Math.min(112, shown.length * 6.4 + 12);
        top += `<rect x="${(60 - w / 2).toFixed(1)}" y="90" width="${w.toFixed(1)}" height="14" rx="7" fill="rgba(20,20,20,0.85)"/>`;
        top += `<text x="60" y="100.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10.5" font-weight="700" fill="#ffffff">${esc(shown)}</text>`;
      }
    }

    return { base: base ? wrapSVG(base) : '', top: top ? wrapSVG(top) : '' };
  };

  return {
    TEAMS, TEAM_KEYS, CORNER_ORDER, TOWER_RADIUS, MAX_LEVEL, MAX_NAME, MAX_NOTE, STRONGHOLD,
    TILES_PER_MOVE, STRONGHOLD_ENTRY,
    OWN_TERRITORY_MULT, ENEMY_TERRITORY_MULT,
    fromAlpha, toAlpha, parseCell, cellId, normalizePosition, cleanName, cleanNote,
    toCube, hexDistance, neighborOffsets, computeTerritory, radiusFor,
    effectiveCost, territoryKind, multipliers, findPath, pathInfoMap, sideBetween,
    normalizePieces, overlayLayers, OVERLAY_BOX, strongholdSVG, towerIcon, pawnIcon
  };
})();

// Lets the logic be tested in Node; harmless in the browser.
if (typeof module !== 'undefined' && module.exports) module.exports = Conquest;
