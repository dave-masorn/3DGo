(function() {
'use strict'

const Liberties = {}

// ── Board conversion ───────────────────────────────────────────
Liberties.fromBoard = function(board) {
  return board.map(row =>
    row.map(cell => {
      if (!cell || !cell.player) return ''
      return cell.player
    })
  )
}

// ── Group & Liberty Computation ─────────────────────────────────
// Returns Map<"col,row", Set<"libCol,libRow">>

Liberties.computeLibertyMap = function(board) {
  const grid = Liberties.fromBoard(board)
  const size = grid.length
  if (size === 0) return new Map()
  const width = grid[0].length

  const visited = Array.from({length: size}, () => Array(width).fill(false))
  const result = new Map()
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]]

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < width; c++) {
      if (visited[r][c] || grid[r][c] === '') continue

      const color = grid[r][c]
      const group = []
      const liberties = new Set()
      const queue = [[r, c]]
      visited[r][c] = true

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()
        group.push([cr, cc])

        for (const [dr, dc] of dirs) {
          const nr = cr + dr
          const nc = cc + dc
          if (nr < 0 || nr >= size || nc < 0 || nc >= width) continue

          if (grid[nr][nc] === '') {
            liberties.add(`${nc},${nr}`)
          } else if (grid[nr][nc] === color && !visited[nr][nc]) {
            visited[nr][nc] = true
            queue.push([nr, nc])
          }
        }
      }

      for (const [gr, gc] of group) {
        result.set(`${gc},${gr}`, liberties)
      }
    }
  }

  return result
}

// ── Groups ──────────────────────────────────────────────────────

Liberties.getGroups = function(board) {
  const grid = Liberties.fromBoard(board)
  const size = grid.length
  if (size === 0) return []
  const width = grid[0].length

  const visited = Array.from({length: size}, () => Array(width).fill(false))
  const groups = []
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]]

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < width; c++) {
      if (visited[r][c] || grid[r][c] === '') continue

      const color = grid[r][c]
      const stones = []
      const liberties = new Set()
      const queue = [[r, c]]
      visited[r][c] = true

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()
        stones.push([cr, cc])

        for (const [dr, dc] of dirs) {
          const nr = cr + dr
          const nc = cc + dc
          if (nr < 0 || nr >= size || nc < 0 || nc >= width) continue

          if (grid[nr][nc] === '') {
            liberties.add(`${nc},${nr}`)
          } else if (grid[nr][nc] === color && !visited[nr][nc]) {
            visited[nr][nc] = true
            queue.push([nr, nc])
          }
        }
      }

      groups.push({color, stones, liberties, libertyCount: liberties.size})
    }
  }

  return groups
}

// ── Liberty counts per color ───────────────────────────────────

Liberties.countByColor = function(board) {
  const libMap = Liberties.computeLibertyMap(board)
  const libToColors = new Map()

  for (const [stoneKey, libSet] of libMap) {
    const [sc, sr] = stoneKey.split(',').map(Number)
    const grid = Liberties.fromBoard(board)
    const stoneColor = grid[sr]?.[sc]

    for (const libKey of libSet) {
      if (!libToColors.has(libKey)) libToColors.set(libKey, new Set())
      libToColors.get(libKey).add(stoneColor)
    }
  }

  const black = new Set()
  const white = new Set()

  for (const [libKey, colors] of libToColors) {
    for (const color of colors) {
      if (color === 'B') black.add(libKey)
      if (color === 'W') white.add(libKey)
    }
  }

  const shared = [...black].filter(x => white.has(x))
  shared.forEach(x => { black.delete(x); white.delete(x) })

  return {
    black: black.size,
    white: white.size,
    shared: shared.length
  }
}

// ── Liberty points for rendering ───────────────────────────────
// Returns Map<"libCol,libRow", Set<"B"|"W">>

Liberties.getLibertyPoints = function(board) {
  const libMap = Liberties.computeLibertyMap(board)
  const libToColors = new Map()

  for (const [stoneKey, libSet] of libMap) {
    const [sc, sr] = stoneKey.split(',').map(Number)
    const grid = Liberties.fromBoard(board)
    const stoneColor = grid[sr]?.[sc]

    for (const libKey of libSet) {
      if (!libToColors.has(libKey)) libToColors.set(libKey, new Set())
      libToColors.get(libKey).add(stoneColor)
    }
  }

  return libToColors
}

// ── Canvas Rendering ───────────────────────────────────────────
// Matches Sabaki bundle.js liberty style exactly:
//   Black lib  → solid #11FfEE  3.5px square, opacity 0.45
//   White lib  → solid #FF0033  3.5px square, opacity 0.45
//   Shared lib → diagonal 45deg gradient
//                linear-gradient(45deg, #11FfEE 50%, #FF0033 0)
//                = bottom-left cyan, top-right red
//   Centered on vertex, no border

Liberties.drawOnCanvas = function(ctx, board, opts = {}) {
  const {
    padding = 36,
    cellSize = null,
    dotSize = 3.5,
    blackColor = '#11ffee',
    whiteColor = '#ff0033',
    opacity = 0.45,
    drawSquare = true
  } = opts

  const grid = Liberties.fromBoard(board)
  const size = grid.length
  if (size === 0) return
  const width = grid[0].length

  if (cellSize === null) {
    const canvasSize = Math.min(ctx.canvas.width, ctx.canvas.height)
    const boardPixels = canvasSize - padding * 2
    cellSize = boardPixels / (Math.max(size, width) - 1)
  }

  const libToColors = Liberties.getLibertyPoints(board)
  const half = dotSize / 2

  ctx.save()
  ctx.globalAlpha = opacity

  for (const [libKey, colors] of libToColors) {
    const [lc, lr] = libKey.split(',').map(Number)
    const cx = padding + lc * cellSize
    const cy = padding + lr * cellSize
    const left = cx - half
    const top = cy - half

    if (colors.size === 2) {
      // Shared liberty matching Sabaki's gradient:
      //   linear-gradient(45deg, #11FfEE 50%, #FF0033 0)
      //   45deg = bottom-left → top-right
      //   Bottom-left region = #11FfEE (black/cyan)
      //   Top-right region = #FF0033 (white/red)
      //   Dividing diagonal: top-left corner → bottom-right corner

      ctx.save()

      // Clip to dot shape
      ctx.beginPath()
      if (drawSquare) {
        ctx.rect(left, top, dotSize, dotSize)
      } else {
        ctx.arc(cx, cy, half, 0, Math.PI * 2)
      }
      ctx.clip()

      // Bottom-left triangle (black/cyan #11FfEE)
      ctx.beginPath()
      ctx.moveTo(left, top)
      ctx.lineTo(left, top + dotSize)
      ctx.lineTo(left + dotSize, top + dotSize)
      ctx.closePath()
      ctx.fillStyle = blackColor
      ctx.fill()

      // Top-right triangle (white/red #FF0033)
      ctx.beginPath()
      ctx.moveTo(left, top)
      ctx.lineTo(left + dotSize, top)
      ctx.lineTo(left + dotSize, top + dotSize)
      ctx.closePath()
      ctx.fillStyle = whiteColor
      ctx.fill()

      ctx.restore()
    } else if (colors.has('B')) {
      ctx.fillStyle = blackColor
      if (drawSquare) {
        ctx.fillRect(left, top, dotSize, dotSize)
      } else {
        ctx.beginPath()
        ctx.arc(cx, cy, half, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      ctx.fillStyle = whiteColor
      if (drawSquare) {
        ctx.fillRect(left, top, dotSize, dotSize)
      } else {
        ctx.beginPath()
        ctx.arc(cx, cy, half, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  ctx.restore()
}

// ── Export ───────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Liberties
} else if (typeof window !== 'undefined') {
  window.Liberties = Liberties
}

})()
