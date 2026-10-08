// Clawd as an SVG, for the surfaces whose font does not join block glyphs into a picture (the
// desktop app draws them as separate boxes). The same glyph rows as the terminal's (CLAWD in
// core.ts), read cell by cell as 2 × 2 quadrants, each quadrant one rectangle: as wide as half a
// terminal cell and as tall as half its height, so he keeps the terminal's proportions.

/** One run of glyphs: plain body, `eyes` (body on the eye colour) or a `lid` (eye colour on body). */
type Span = { text: string; on?: 'eyes' | 'lid' }

/** Quadrants a block glyph fills: top left, top right, bottom left, bottom right. */
const QUADRANTS: Record<string, [boolean, boolean, boolean, boolean]> = {
  ' ': [false, false, false, false],
  '█': [true, true, true, true],
  '▀': [true, true, false, false],
  '▄': [false, false, true, true],
  '▌': [true, false, true, false],
  '▐': [false, true, false, true],
  '▘': [true, false, false, false],
  '▝': [false, true, false, false],
  '▖': [false, false, true, false],
  '▗': [false, false, false, true],
  '▛': [true, true, true, false],
  '▜': [true, true, false, true],
  '▙': [true, false, true, true],
  '▟': [false, true, true, true],
  '▚': [true, false, false, true],
  '▞': [false, true, true, false],
  // A lid (lower eighths) is drawn as its lower half: the nearest quadrants.
  '▂': [false, false, true, true],
}

/** Width and height of one quadrant, in CSS pixels: a terminal cell is about twice as tall as wide. */
export const CLAWD_QUAD = { w: 5, h: 10 }

/**
 * Clawd's glyph rows as an SVG: a rectangle per filled quadrant in `body`; under an `eyes` span the
 * empty quadrants in `eyes` (the body on the eye colour), under a `lid` the reverse. Unknown glyphs
 * draw nothing. Returns the markup and its size.
 */
export const clawdSvg = (rows: Span[][], body: string, eyes: string): { source: string; width: number; height: number } => {
  const { w, h } = CLAWD_QUAD
  const rects: string[] = []
  let cols = 0
  rows.forEach((row, y) => {
    let x = 0
    for (const span of row) {
      for (const ch of Array.from(span.text)) {
        const q = QUADRANTS[ch]
        if (q) {
          q.forEach((filled, k) => {
            const fill = span.on === 'eyes' ? (filled ? body : eyes) : span.on === 'lid' ? (filled ? eyes : body) : filled ? body : null
            if (!fill) return
            const px = (2 * x + (k % 2)) * w
            const py = (2 * y + Math.floor(k / 2)) * h
            rects.push(`<rect x="${px}" y="${py}" width="${w}" height="${h}" fill="${fill}"/>`)
          })
        }
        x += 1
      }
    }
    cols = Math.max(cols, x)
  })
  const width = cols * 2 * w
  const height = rows.length * 2 * h
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges">${rects.join('')}</svg>`
  return { source, width, height }
}
