// Rebuilds the lines of a PDF page from where each piece of text sits.
//
// PDF.js hands back pieces of text with positions. Joining them in stream order
// is fine for a single column, but a designed CV (a sidebar of contact details
// beside the main column) is often written row by row, so a left piece and a
// right piece of the same row end up glued into one line ("Santa Ana, CA 92703
// Bachelor of Science,") and the two columns get mixed together.
//
// What this does:
//   1. Pieces on the same row are joined into one line, as before, except where
//      there is a wide gap: that is a separate block (a column, or a date
//      pushed to the right edge).
//   2. If the page is genuinely laid out in columns, each column is read from
//      top to bottom, one after the other.
//   3. Otherwise the blocks of a row are joined with a space, exactly like a
//      plain single-column page, so "Phone:" and its value stay together.
//
// Column mode needs clear evidence (two or more distinct left edges, far apart,
// each used by several blocks) and is refused when the left side is just
// labels with values beside them (a form or table), because splitting those
// would separate every label from its value.

import { BARE_LABEL } from './fieldLabels.js';

// Points. A gap this wide starts a new block. Word spaces are about a quarter of
// the font height, so this sits well above them yet below the narrow gutter of a
// two-column CV, where one column's text nearly touches the next.
const MIN_BLOCK_GAP = 12;
const MIN_COLUMN_DISTANCE = 110; // points between the left edges of two columns
const MIN_BLOCKS_PER_COLUMN = 3;
const EDGE_ROUNDING = 6;
// Share of the text to the left of a column that may run on across it before it
// is not a real column (a few full-width headings are normal in a column layout).
const MAX_CROSSING_SHARE = 0.12;

const isLabelLike = (text) => {
  const t = text.trim();
  return (
    t.length <= 24 &&
    (/[:：]$/.test(t) || /^(?:name|address|phone|mobile|email|e-mail|tel|dob)$/i.test(t))
  );
};

// The rows of a page: [{ y, blocks: [{ x0, text }] }], top to bottom.
function buildRows(items) {
  const pieces = items
    .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width ?? 0,
      height: Math.abs(item.height) || Math.abs(item.transform[3]) || 10,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const piece of pieces) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - piece.y) <= row.height * 0.45) row.pieces.push(piece);
    else rows.push({ y: piece.y, height: piece.height, pieces: [piece] });
  }

  return rows.map((row) => {
    const sorted = row.pieces.sort((a, b) => a.x - b.x);
    const blocks = [];
    let end = null;
    for (const piece of sorted) {
      const gap = end === null ? 0 : piece.x - end;
      const wide = Math.max(MIN_BLOCK_GAP, row.height * 1.3);
      const block = blocks[blocks.length - 1];
      if (!block || gap > wide) {
        blocks.push({ x0: piece.x, x1: piece.x + piece.width, text: piece.str });
      } else {
        const space = gap > row.height * 0.12 && !/\s$/.test(block.text) && !/^\s/.test(piece.str);
        block.text += (space ? ' ' : '') + piece.str;
        block.x1 = piece.x + piece.width;
      }
      end = piece.x + piece.width;
    }
    return {
      y: row.y,
      blocks: blocks.map((b) => ({ x0: b.x0, x1: b.x1, text: b.text.replace(/\s+$/, '') })),
    };
  });
}

// Left edges used by several blocks and far enough apart to be columns.
function findColumns(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const block of row.blocks) {
      const edge = Math.round(block.x0 / EDGE_ROUNDING) * EDGE_ROUNDING;
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }
  const edges = [...counts.entries()]
    .filter(([, count]) => count >= MIN_BLOCKS_PER_COLUMN)
    .map(([edge]) => edge)
    .sort((a, b) => a - b);

  const columns = [];
  for (const edge of edges) {
    if (columns.length === 0 || edge - columns[columns.length - 1] >= MIN_COLUMN_DISTANCE) {
      columns.push(edge);
    }
  }

  // A column edge is real only if the text to its left stays to its left. When
  // lines run on across it, the "column" is just a table or an indented block in
  // a single-column page (a form with labels at one edge and values at another).
  return columns.filter((edge, i) => {
    if (i === 0) return true;
    const left = rows.flatMap((row) => row.blocks).filter((b) => b.x0 < edge - EDGE_ROUNDING);
    const crossing = left.filter((b) => b.x1 > edge + 4).length;
    return left.length > 0 && crossing / left.length <= MAX_CROSSING_SHARE;
  });
}

// True when the left column is mostly short labels with values beside them.
function looksLikeForm(rows, columns) {
  const left = [];
  for (const row of rows) {
    for (const block of row.blocks) {
      if (block.x0 < columns[1] - EDGE_ROUNDING) left.push(block);
    }
  }
  if (left.length === 0) return false;
  // "Phone:" with its value beside it is a form. A sidebar also has bare words
  // such as "Phone" or "Email" as small headings above their values, so bare
  // labels count only when nearly everything on the left is one.
  const withColon = left.filter((block) => /[:：]$/.test(block.text.trim())).length;
  const anyLabel = left.filter((block) => isLabelLike(block.text)).length;
  return withColon / left.length >= 0.5 || anyLabel / left.length >= 0.75;
}

// One row's blocks as a line. A bare field label with its value beside it (a
// form or table row: "Applied Position" then "Software Developer") becomes
// "Applied Position: Software Developer", so label and value stay together.
function rowText(row) {
  const [first, ...rest] = row.blocks;
  if (rest.length > 0 && BARE_LABEL.test(first.text) && !/[:：]$/.test(first.text.trim())) {
    return `${first.text.trim()}: ${rest.map((b) => b.text).join(' ')}`;
  }
  return row.blocks.map((b) => b.text).join(' ');
}

// The text of one page, one line per block, in reading order.
export function layoutPageText(items) {
  const rows = buildRows(items);
  const columns = findColumns(rows);

  if (columns.length >= 2 && !looksLikeForm(rows, columns)) {
    const lanes = columns.map(() => []);
    for (const row of rows) {
      for (const block of row.blocks) {
        let lane = 0;
        for (let i = 0; i < columns.length; i += 1) {
          if (block.x0 >= columns[i] - EDGE_ROUNDING) lane = i;
        }
        lanes[lane].push(block.text);
      }
    }
    return lanes.map((lane) => lane.join('\n')).join('\n');
  }

  return rows.map(rowText).join('\n');
}
