import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  combineHeaders,
  extractTileCoords,
  formatCoord,
  formatTime,
  MVT_REQUEST_PATTERNS,
  tileFileName,
} from '../src/utils.ts'
import type { TableEntry } from '../src/types.ts'

const entry = (over: Partial<TableEntry> = {}): TableEntry => ({
  x: 512,
  y: 384,
  z: 10,
  status: 200,
  url: 'https://example.com/tiles/10/512/384.mvt',
  headers: {},
  startOrder: 1,
  startedDateTime: '2026-01-01T00:00:00.000Z',
  time: 12,
  endOrder: 1,
  extra: { isPending: false, isValid: true, isEmpty: false },
  ...over,
})

describe('extractTileCoords', () => {
  it('reads a plain z/x/y triple', () => {
    assert.deepEqual(extractTileCoords('https://example.com/tiles/10/512/384.mvt'), {
      z: 10,
      x: 512,
      y: 384,
    })
  })

  it('does not start matching mid-segment', () => {
    // The "3" of "v3" must not be treated as the zoom level.
    assert.deepEqual(extractTileCoords('https://ex.com/data/v3/14/1234/5678.pbf?token=a'), {
      z: 14,
      x: 1234,
      y: 5678,
    })
  })

  it('finds a triple that is not at the end of the URL', () => {
    assert.deepEqual(extractTileCoords('https://example.com/10/512/384/tile.mvt'), {
      z: 10,
      x: 512,
      y: 384,
    })
  })

  it('tolerates a retina suffix', () => {
    assert.deepEqual(extractTileCoords('https://example.com/tiles/10/512/384@2x.pbf'), {
      z: 10,
      x: 512,
      y: 384,
    })
  })

  it('prefers the deepest triple', () => {
    assert.deepEqual(extractTileCoords('https://a.com/v2/1/2/3/tiles/10/512/384.mvt'), {
      z: 10,
      x: 512,
      y: 384,
    })
  })

  it('handles zero coordinates', () => {
    assert.deepEqual(extractTileCoords('https://example.com/tiles/0/0/0.mvt'), { z: 0, x: 0, y: 0 })
  })

  it('returns undefined when there is no triple', () => {
    assert.equal(extractTileCoords('https://example.com/style/sprite.png'), undefined)
    assert.equal(extractTileCoords('https://example.com/wmts?tilerow=512&tilecol=384'), undefined)
  })
})

describe('MVT_REQUEST_PATTERNS', () => {
  it('are all valid regular expressions with z/x/y groups', () => {
    for (const source of MVT_REQUEST_PATTERNS) {
      const match = 'https://example.com/tiles/10/512/384.mvt'.match(new RegExp(source, 'i'))
      // Not every preset targets .mvt, but each must at least compile.
      if (match) assert.deepEqual({ ...match.groups }, { z: '10', x: '512', y: '384' })
    }
  })

  it('match the URL shapes they are named for', () => {
    const matches = (index: number, url: string) =>
      new RegExp(MVT_REQUEST_PATTERNS[index]!, 'i').test(url)

    assert.ok(matches(0, 'https://example.com/tiles/10/512/384.mvt'))
    assert.ok(!matches(0, 'https://example.com/tiles/10/512/384.pbf'))
    assert.ok(matches(1, 'https://example.com/tiles/10/512/384'))
    assert.ok(matches(2, 'https://example.com/tiles/10/512/384.pbf'))
    assert.ok(matches(3, 'https://api.mapbox.com/v4/s/12/2048/1362.vector.pbf?t=x'))
    assert.ok(matches(4, 'https://example.com/tiles/10/512/384@2x.pbf'))
  })

  it('do not match unrelated assets', () => {
    for (const source of MVT_REQUEST_PATTERNS) {
      assert.ok(!new RegExp(source, 'i').test('https://example.com/style/sprite.png'))
    }
  })
})

describe('tileFileName', () => {
  it('uses the coordinates when they are known', () => {
    assert.equal(tileFileName(entry()), '10_512_384.mvt')
  })

  it('falls back to the URL when coordinates are unknown', () => {
    const unknown = entry({ z: NaN, x: NaN, y: NaN, url: 'https://example.com/a/tile-42.pbf?k=1' })
    assert.equal(tileFileName(unknown), 'tile-42.mvt')
  })

  it('falls back to a fixed name when the URL yields nothing usable', () => {
    assert.equal(
      tileFileName(entry({ z: NaN, x: NaN, y: NaN, url: 'https://example.com/' })),
      'tile.mvt',
    )
  })
})

describe('formatCoord', () => {
  it('renders finite numbers and marks unknown ones', () => {
    assert.equal(formatCoord(0), '0')
    assert.equal(formatCoord(384), '384')
    assert.equal(formatCoord(NaN), '?')
  })
})

describe('combineHeaders', () => {
  it('collapses a header list into an object', () => {
    assert.deepEqual(
      combineHeaders([
        { name: 'Accept', value: '*/*' },
        { name: 'X-Test', value: '1' },
      ]),
      { Accept: '*/*', 'X-Test': '1' },
    )
  })

  it('returns an empty object for no headers', () => {
    assert.deepEqual(combineHeaders([]), {})
  })
})

describe('formatTime', () => {
  it('returns an empty string for a missing date', () => {
    assert.equal(formatTime(''), '')
  })

  it('formats as local hh:mm:ss.mmm', () => {
    // Compared against the same Date to stay timezone independent.
    const iso = '2026-01-01T12:34:56.789Z'
    const d = new Date(iso)
    const pad = (n: number, len = 2) => String(n).padStart(len, '0')
    assert.equal(
      formatTime(iso),
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`,
    )
  })
})
