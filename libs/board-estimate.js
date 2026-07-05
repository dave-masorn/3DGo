(function() {
'use strict'

const BoardEstimate = {}

// ── Board conversion ───────────────────────────────────────────
// Convert baduk-notes board format to sign map:
//   +1 = black stone, -1 = white stone, 0 = empty
BoardEstimate.fromBoard = function(board) {
  return board.map(row =>
    row.map(cell => {
      if (!cell || !cell.player) return 0;
      return cell.player === 'B' ? 1 : -1;
    })
  );
}

// ── Helper functions ────────────────────────────────────────────

function getNeighbors([x, y]) {
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
}

function getChain(data, v, result = [], done = {}, sign = null) {
  if (sign == null) sign = data[v[1]][v[0]]
  let neighbors = getNeighbors(v)

  result.push(v)
  done[v] = true

  for (let n of neighbors) {
    if (!data[n[1]] || data[n[1]][n[0]] !== sign || n in done) continue
    getChain(data, n, result, done, sign)
  }

  return result
}

function average(arr, defaultValue = null) {
  return arr.length !== 0
    ? arr.reduce((sum, x) => sum + x, 0) / arr.length
    : defaultValue
}

// ── detectDeadStonesHeuristic ─────────────────────────────────
// Identifies dead stones by removing low-liberty chains and checking
// if opponent influence completely fills their void.
BoardEstimate.detectDeadStonesHeuristic = function(data) {
  let height = data.length
  let width = height === 0 ? 0 : data[0].length
  let deadMap = [...Array(height)].map(_ => Array(width).fill(false))
  
  let visited = [...Array(height)].map(_ => Array(width).fill(false))
  let chains = []
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y][x] !== 0 && !visited[y][x]) {
        let stone = data[y][x]
        let chain = []
        let liberties = new Set()
        let stack = [{r: y, c: x}]
        visited[y][x] = true
        
        while (stack.length > 0) {
          let curr = stack.pop()
          chain.push(curr)
          let neighbors = [
            {r: curr.r-1, c: curr.c}, {r: curr.r+1, c: curr.c},
            {r: curr.r, c: curr.c-1}, {r: curr.r, c: curr.c+1}
          ]
          for (let n of neighbors) {
            if (n.r >= 0 && n.r < height && n.c >= 0 && n.c < width) {
              if (data[n.r][n.c] === stone && !visited[n.r][n.c]) {
                visited[n.r][n.c] = true
                stack.push(n)
              } else if (data[n.r][n.c] === 0) {
                liberties.add(`${n.r},${n.c}`)
              }
            }
          }
        }
        chains.push({stone, pts: chain, liberties: liberties.size})
      }
    }
  }
  
  // Chains with <= 2 liberties are candidates for being dead
  let suspiciousChains = chains.filter(c => c.liberties <= 2)
  if (suspiciousChains.length === 0) return deadMap;
  
  // Remove all suspicious chains to test influence
  let testData = data.map(row => [...row])
  for (let chain of suspiciousChains) {
    for (let pt of chain.pts) {
      testData[pt.r][pt.c] = 0
    }
  }
  
  // Run influence map without the suspicious stones
  let infMap = BoardEstimate.influenceMap(testData, {discrete: true})
  
  // If opponent influence fills the void, the stone was dead
  for (let chain of suspiciousChains) {
    let isDead = true
    for (let pt of chain.pts) {
      if (infMap[pt.r][pt.c] === chain.stone || infMap[pt.r][pt.c] === 0) {
        isDead = false;
        break;
      }
    }
    if (isDead) {
      for (let pt of chain.pts) {
        deadMap[pt.r][pt.c] = true
      }
    }
  }
  
  return deadMap;
}

// ── detectDeadStones ────────────────────────────────────────────
// Heuristically identifies likely dead stones based on liberties and enemy radiance.
// Returns a 2D boolean array.
BoardEstimate.detectDeadStones = function(data) {
  let height = data.length
  let width = height === 0 ? 0 : data[0].length
  let deadMap = [...Array(height)].map(_ => Array(width).fill(false))
  let done = {}

  let prmap = BoardEstimate.radianceMap(data, 1)
  let nrmap = BoardEstimate.radianceMap(data, -1)

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = [x, y]
      let sign = data[y][x]
      if (sign === 0 || v in done) continue

      let chain = getChain(data, v)
      let liberties = 0;
      let libertyVisited = {};
      
      chain.forEach(w => done[w] = true)
      
      for (let c of chain) {
         for (let n of getNeighbors(c)) {
             let [nx, ny] = n
             if (data[ny] && data[ny][nx] === 0 && !libertyVisited[n]) {
                 libertyVisited[n] = true;
                 liberties++;
             }
         }
      }

      if (liberties <= 2) {
          let enemyRadianceSum = 0;
          let friendlyRadianceSum = 0;
          let checkPoints = 0;
          
          for (let c of chain) {
              for (let n of getNeighbors(c)) {
                 let [nx, ny] = n
                 if (data[ny] && data[ny][nx] === 0) {
                     checkPoints++;
                     enemyRadianceSum += sign > 0 ? nrmap[ny][nx] : prmap[ny][nx];
                     friendlyRadianceSum += sign > 0 ? prmap[ny][nx] : nrmap[ny][nx];
                 }
              }
          }
          
          let avgEnemyRadiance = checkPoints > 0 ? enemyRadianceSum / checkPoints : 0;
          let avgFriendlyRadiance = checkPoints > 0 ? friendlyRadianceSum / checkPoints : 0;
          
          if (avgEnemyRadiance > 3 && avgFriendlyRadiance < 1.5) {
              for (let c of chain) {
                  deadMap[c[1]][c[0]] = true;
              }
          }
      }
    }
  }
  return deadMap
}

// ── areaMap ─────────────────────────────────────────────────────
// Assigns territory based on which color borders each empty region.
// Returns: array of arrays with +1 (black), -1 (white), 0 (neutral)

BoardEstimate.areaMap = function(data, {territoryBlack = [], territoryWhite = []} = {}) {
  let height = data.length
  let width = height === 0 ? 0 : data[0].length
  let map = [...Array(height)].map(_ => Array(width).fill(null))

  territoryBlack.forEach(pt => {
      if (map[pt.r] && map[pt.r][pt.c] !== undefined) map[pt.r][pt.c] = 1;
  });
  territoryWhite.forEach(pt => {
      if (map[pt.r] && map[pt.r][pt.c] !== undefined) map[pt.r][pt.c] = -1;
  });

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let vertex = [x, y]

      if (map[y][x] !== null) continue
      if (data[y][x] !== 0) {
        map[y][x] = data[y][x]
        continue
      }

      let chain = getChain(data, vertex)
      let sign = 0
      let indicator = 1

      for (let c of chain) {
        if (indicator === 0) break

        for (let n of getNeighbors(c)) {
          let [nx, ny] = n
          if (!data[ny] || data[ny][nx] == null || data[ny][nx] === 0) continue

          if (sign === 0) {
            sign = Math.sign(data[ny][nx])
          } else if (sign !== Math.sign(data[ny][nx])) {
            indicator = 0
            break
          }
        }
      }

      for (let [cx, cy] of chain) {
        map[cy][cx] = sign * indicator
      }
    }
  }

  return map
}

// ── nearestNeighborMap ──────────────────────────────────────────
// Manhattan distance to the nearest stone of given sign.

BoardEstimate.nearestNeighborMap = function(data, sign) {
  let height = data.length
  let width = height === 0 ? 0 : data[0].length
  let map = [...Array(height)].map(_ => Array(width).fill(Infinity))
  let min = Infinity

  let f = (x, y) => {
    if (data[y][x] === sign) min = 0
    else min++

    map[y][x] = min = Math.min(min, map[y][x])
  }

  for (let y = 0; y < height; y++) {
    min = Infinity

    for (let x = 0; x < width; x++) {
      let old = Infinity

      f(x, y)
      old = min

      for (let ny = y + 1; ny < height; ny++) f(x, ny)
      min = old

      for (let ny = y - 1; ny >= 0; ny--) f(x, ny)
      min = old
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    min = Infinity

    for (let x = width - 1; x >= 0; x--) {
      let old = Infinity

      f(x, y)
      old = min

      for (let ny = y + 1; ny < height; ny++) f(x, ny)
      min = old

      for (let ny = y - 1; ny >= 0; ny--) f(x, ny)
      min = old
    }
  }

  return map
}

// ── radianceMap ─────────────────────────────────────────────────
// Propagates "radiance" from each chain to estimate influence.

BoardEstimate.radianceMap = function(data, sign, {p1 = 6, p2 = 1.5, p3 = 2} = {}) {
  let height = data.length
  let width = height === 0 ? 0 : data[0].length
  let map = [...Array(height)].map(_ => Array(width).fill(0))
  let size = [width, height]
  let done = {}

  let getMirroredVertex = v => {
    if (v[0] >= 0 && v[0] < width && v[1] >= 0 && v[1] < height) return v
    return v.map((z, i) =>
      z < 0 ? -z - 1 : z >= size[i] ? 2 * size[i] - z - 1 : z
    )
  }

  let castRadiance = chain => {
    let queue = chain.map(x => [x, 0])
    let visited = {}

    while (queue.length > 0) {
      let [v, d] = queue.shift()
      let mv = getMirroredVertex(v)

      map[mv[1]][mv[0]] += mv !== v ? p3 : p2 / (d / p1 * 6 + 1)

      for (let n of getNeighbors(v)) {
        if (d >= p1 || (data[n[1]] && data[n[1]][n[0]] === -sign) || n in visited)
          continue

        visited[n] = true
        queue.push([n, d + 1])
      }
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = [x, y]
      if (data[y][x] !== sign || v in done) continue

      let chain = getChain(data, v)
      chain.forEach(w => done[w] = true)

      castRadiance(chain)
    }
  }

  return map
}

// ── influenceMap ────────────────────────────────────────────────
// Combines nearestNeighbor + radiance to produce continuous influence.
// With {discrete: true}, returns -1/0/+1 territory map.

BoardEstimate.influenceMap = function(data, {discrete = false, maxDistance = 6, minRadiance = 2} = {}) {
  let height = data.length
  let width = height === 0 ? 0 : data[0].length
  let areamap = BoardEstimate.areaMap(data)
  let map = areamap.map(row => [...row])
  let pnnmap = BoardEstimate.nearestNeighborMap(data, 1)
  let nnnmap = BoardEstimate.nearestNeighborMap(data, -1)
  let prmap = BoardEstimate.radianceMap(data, 1)
  let nrmap = BoardEstimate.radianceMap(data, -1)
  let max = -Infinity
  let min = Infinity

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (map[y][x] !== 0) continue

      let s = Math.sign(nnnmap[y][x] - pnnmap[y][x])
      let faraway = s === 0 || (s > 0 ? pnnmap : nnnmap)[y][x] > maxDistance
      let dim = s === 0 || Math.round((s > 0 ? prmap : nrmap)[y][x]) < minRadiance

      if (faraway || dim) map[y][x] = 0
      else map[y][x] = s * (s > 0 ? prmap[y][x] : nrmap[y][x])

      max = Math.max(max, map[y][x])
      min = Math.min(min, map[y][x])

      if (discrete) map[y][x] = Math.sign(map[y][x])
    }
  }

  // Postprocessing

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (areamap[y][x] !== 0) continue

      let sign = Math.sign(map[y][x])
      let neighbors = getNeighbors([x, y]).filter(([i, j]) => data[j] && data[j][i] != null)
      let friendlyNeighbors = sign === 0 ? null : neighbors.filter(([i, j]) => Math.sign(map[j][i]) === sign)

      // Prevent single point areas
      if (sign !== 0) {
        if (neighbors.length >= 2 && neighbors.every(([i, j]) => Math.sign(map[j][i]) !== sign)) {
          map[y][x] = 0
          continue
        }
      }

      // Fix ragged areas
      if (sign !== 0) {
        if (friendlyNeighbors.length === 1) {
          let [i, j] = friendlyNeighbors[0]
          if (data[j][i] === sign) {
            map[y][x] = 0
            continue
          }
        }
      }

      // Fix empty pillars
      let distance = Math.min(x, y, width - x - 1, height - y - 1)

      if (distance <= 2 && sign !== 0) {
        let signedNeighbors = neighbors.filter(([i, j]) => map[j] && map[j][i] !== 0)

        if (signedNeighbors.length >= 2) {
          let [[i1, j1], [i2, j2]] = signedNeighbors
          let s = Math.sign(map[j1][i1])

          if (
            (signedNeighbors.length >= 3 || i1 === i2 || j1 === j2) &&
            signedNeighbors.every(([i, j]) => Math.sign(map[j][i]) === s)
          ) {
            map[y][x] = !discrete
              ? average(signedNeighbors.map(([i, j]) => map[j][i]))
              : s
            sign = s
          }
        }
      }

      // Blur
      if (!discrete && sign !== 0) {
        map[y][x] = average([[x, y], ...friendlyNeighbors].map(([i, j]) => map[j][i]))
      }
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (areamap[y][x] !== 0 || map[y][x] === 0) continue

      let sign = Math.sign(map[y][x])

      // Normalize
      if (!discrete) {
        if (sign > 0) {
          map[y][x] = Math.min(map[y][x] / max, 1)
        } else if (sign < 0) {
          map[y][x] = Math.max(-map[y][x] / min, -1)
        }
      }
    }
  }

  return BoardEstimate.areaMap(map)
}

// ── getScore: compute area & territory score from areaMap ──────
// board: sign map (from BoardEstimate.fromBoard)
// areaMap: from BoardEstimate.areaMap or influenceMap({discrete: true})
// options: {komi, handicap}

BoardEstimate.getScore = function(board, areaMap, {komi = 6.5, handicap = 0} = {}) {
    let score = {
        area: [0, 0],
        territory: [0, 0],
        captures: [0, 0],
        deadStones: [0, 0]
    };

    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        let z = areaMap[y][x]
        let stone = board[y][x]

        if (stone === 1 && z === -1) {
            score.deadStones[1]++;
            score.territory[1]++;
            score.area[1]++;
        } else if (stone === -1 && z === 1) {
            score.deadStones[0]++;
            score.territory[0]++;
            score.area[0]++;
        } else {
            let index = z > 0 ? 0 : z < 0 ? 1 : -1;
            if (index !== -1) {
                score.area[index] += Math.abs(Math.sign(z))
                if (stone === 0)
                    score.territory[index] += Math.abs(Math.sign(z))
            }
        }
      }
    }

    score.areaScore = score.area[0] - score.area[1] - komi - handicap;
    score.territoryScore = score.territory[0] - score.territory[1] 
                         + score.captures[0] + score.deadStones[0]
                         - score.captures[1] - score.deadStones[1] 
                         - komi;

    return score;
}

// ── High-level convenience: estimate from baduk-notes state ────
// board: state.board array
// options: {komi, handicap, method: 'area'|'territory'|'influence'}

BoardEstimate.estimate = function(board, {komi = 6.5, handicap = 0, territoryBlack = [], territoryWhite = [], inGameCaptures = {B: 0, W: 0}, rules = 'japanese', aiDeadMap = null} = {}) {
  let originalData = BoardEstimate.fromBoard(board)
  let data = BoardEstimate.fromBoard(board)
  let aMap;

  if (territoryBlack.length === 0 && territoryWhite.length === 0) {
      // Find dead stones via heuristic removal and influence testing, or use AI map
      let deadMap = aiDeadMap ? aiDeadMap : BoardEstimate.detectDeadStonesHeuristic(data)
      
      // Remove dead stones from data so they become empty points
      for (let y = 0; y < data.length; y++) {
          for (let x = 0; x < data[y].length; x++) {
              if (deadMap[y][x]) data[y][x] = 0
          }
      }
      
      // Third pass: recalculate influence map with dead stones removed
      aMap = BoardEstimate.influenceMap(data, {discrete: true})
  } else {
      aMap = BoardEstimate.areaMap(data, {territoryBlack, territoryWhite})
  }

  let score = BoardEstimate.getScore(originalData, aMap, {komi, handicap})
  
  score.captures[0] += inGameCaptures.B;
  score.captures[1] += inGameCaptures.W;
  
  // Recalculate territoryScore since inGameCaptures were just added
  score.territoryScore = score.territory[0] - score.territory[1] 
                       + score.captures[0] + score.deadStones[0]
                       - score.captures[1] - score.deadStones[1] 
                       - komi;

  let isArea = rules.toLowerCase().includes('chinese') || rules.toLowerCase().includes('aga') || rules.toLowerCase().includes('nz');
  let finalScore = isArea ? score.areaScore : score.territoryScore;

  return {
    areaMap: aMap,
    score,
    isArea,
    result: finalScore > 0
      ? `B+${finalScore.toFixed(1)}`
      : finalScore < 0
        ? `W+${Math.abs(finalScore).toFixed(1)}`
        : 'Draw'
  }
}

// ── Export ───────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoardEstimate
} else if (typeof window !== 'undefined') {
  window.BoardEstimate = BoardEstimate
}

})()
