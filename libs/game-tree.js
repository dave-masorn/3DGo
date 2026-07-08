(function() {
'use strict'

var _container = null
var _lastIndex = -1
var _svgWrap = null
var _sliderSpan = null
var _slidingArea = null
var _prevBtn = null
var _nextBtn = null

var _gridSize = 24
var _nodeSize = 6
var _curScale = 1.8
var _nodeX = Math.round(_gridSize * 1.5)
var _zoom = 1
var _lastZoom = 1
var _camX = -_gridSize
var _camY = -_gridSize
var _viewW = 0
var _viewH = 0
var _totalH = 0

var _mouseDown = null
var _drag = false
var _initialCentered = false
var _animId = null
var _animateNext = false
var _treeCurIdx = -1

// Footer tree — cloned vertical tree rotated 90° CCW
var _footerWrap = null
var _footerCamY = 0
var _fDrag = false
var _fDragData = null
var _footerLastIdx = -1
var _footerText = null
var _footerMouseDown = false
var _footerAnimId = null

var navigate = function(idx) {
  if (typeof goToMove === 'function' && typeof state !== 'undefined' && state) {
    var count = (state.sgfMoves || []).length
    if (!count) return
    goToMove(Math.max(-1, Math.min(count - 1, idx)))
  }
}

var animateY = function(targetY, duration) {
  if (_animId) { cancelAnimationFrame(_animId); _animId = null }
  var startY = _camY
  var startTime = null
  var step = function(timestamp) {
    if (!startTime) startTime = timestamp
    var progress = Math.min(1, (timestamp - startTime) / duration)
    var eased = 1 - Math.pow(1 - progress, 3)
    _camY = startY + (targetY - startY) * eased
    applyCamera()
    if (progress < 1) {
      _animId = requestAnimationFrame(step)
    } else {
      _animId = null
    }
  }
  _animId = requestAnimationFrame(step)
}

var animateFooterCam = function(targetY, duration) {
  if (_footerAnimId) { cancelAnimationFrame(_footerAnimId); _footerAnimId = null }
  var startY = _footerCamY
  var startTime = null
  var step = function(timestamp) {
    if (!startTime) startTime = timestamp
    var progress = Math.min(1, (timestamp - startTime) / duration)
    var eased = 1 - Math.pow(1 - progress, 3)
    _footerCamY = startY + (targetY - startY) * eased
    applyCamera()
    if (progress < 1) {
      _footerAnimId = requestAnimationFrame(step)
    } else {
      _footerAnimId = null
    }
  }
  _footerAnimId = requestAnimationFrame(step)
}

var centerOnNode = function(idx, animated) {
  if (!_viewW || !_viewH) return
  var nodeY = _nodeSize * _zoom + idx * _gridSize * _zoom
  var effNodeX = Math.round(_gridSize * _zoom * 1.5)
  _camX = Math.round(effNodeX - _viewW / 2)
  var targetY = Math.round(nodeY - _viewH / 2)
  _initialCentered = true
  if (animated) {
    animateY(targetY, 200)
  } else {
    _camY = targetY
    applyCamera()
  }
}

var applyCamera = function() {
  var sty = _svgWrap && _svgWrap.querySelector('style[data-cam]')
  if (sty) {
    sty.textContent = '#gt-graph svg > * { transform: translate(' + (-_camX) + 'px, ' + (-_camY) + 'px); transform-origin:0 0 }'
  }
  var fsty = _footerWrap && _footerWrap.querySelector('style[data-fcam]')
  if (fsty) {
    fsty.textContent = '.gt-footer-inner svg > * { transform: translate(0px, ' + (-_footerCamY) + 'px); transform-origin:0 0 }'
  }
}

var renderFooterTree = function() {
  if (!_footerWrap || typeof state === 'undefined' || !state) return
  var moves = state.sgfMoves || []
  var idx = state.currentMoveIndex
  var count = moves.length
  var prevIdx = _footerLastIdx
  _footerLastIdx = idx

  if (!count) {
    _footerWrap.innerHTML = ''
    _footerWrap.style.display = 'none'
    // Restore footer text when SGF is cleared
    var footer = document.querySelector('footer.app-footer') || document.getElementById('replay-timeline-wrap');
    if (footer) {
      if (_footerText) _footerText.style.display = ''
      footer.classList.remove('tree-active')
    }
    return
  }

  // Re-enter tree mode (in case it was cleared by a previous SGF clear)
  var footer = document.querySelector('footer.app-footer') || document.getElementById('replay-timeline-wrap');
  if (footer) {
    if (_footerText) _footerText.style.display = 'none'
    footer.classList.add('tree-active')
  }

  var zGrid = _gridSize * _zoom
  var zNode = _nodeSize * _zoom
  var zCur = zNode * _curScale
  var zNodeX = Math.round(zGrid * 1.5)
  var totalH = zNode + zGrid + zCur + (count - 1) * zGrid + zNode
  var rootY = zNode - zGrid

  // Footer tree — fixed vertical height (horizontal after rotation)
  var h = 175
  var sliderW = 20
  var footH = h + sliderW

  var parts = []
  parts.push('<svg width="' + h + '" height="' + totalH + '" style="display:block;margin-left:' + sliderW + 'px">')

  var pts = []
  if (count > 0) {
    pts.push(zNodeX + ',' + rootY + ' ' + zNodeX + ',' + (zNode + 0 * zGrid))
  }
  for (var i = 0; i < count - 1; i++) {
    pts.push(zNodeX + ',' + (zNode + i * zGrid) + ' ' + zNodeX + ',' + (zNode + (i + 1) * zGrid))
  }
  if (pts.length) {
    parts.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#ccc" stroke-width="1"></polyline>')
  }

  parts.push('<g>')
  var isRootCur = (idx === -1)
  parts.push('<path d="' + diamondPath(zNodeX, rootY, zNode) + '" class="fnode' + (isRootCur ? ' current' : '') + '" fill="rgb(238,238,238)" data-idx="-1" style="cursor:pointer"></path>')
  for (var i = 0; i < count; i++) {
    var isCur = i === idx
    var r = zNode * (isCur ? _curScale : 1)
    var y = zNode + i * zGrid
    var move = moves[i] || {}
    var p = nodeProps(move)
    var cls = 'fnode' + (isCur ? ' current' : '')
    parts.push('<path d="' + nodePath(zNodeX, y, r) + '" class="' + cls + '" fill="' + p.fill + '" data-idx="' + i + '"></path>')
  }
  parts.push('</g></svg>')

  // Slider (same as vertical tree)
  var pct = count > 1 ? (idx < 0 ? 0 : (idx / (count - 1)) * 100) : 50
  parts.push('<section class="gt-fslider">')
  parts.push('<a href="#" class="fprev">▲</a>')
  parts.push('<div class="finner"><span style="top:' + pct + '%">' + (idx < 0 ? '0' : idx + 1) + '</span></div>')
  parts.push('<a href="#" class="fnext">▼</a>')
  parts.push('</section>')

  // Camera style
  parts.push('<style data-fcam="">.gt-footer-inner svg > * { transform: translate(0px, 0px); transform-origin:0 0 }</style>')

  _footerWrap.innerHTML = '<div class="gt-footer-inner">' + parts.join('') + '</div>'

  // Ensure wrap visible (in case it was hidden by SGF clear) and position the rotated tree
  _footerWrap.style.display = ''
  var inner = _footerWrap.querySelector('.gt-footer-inner')
  if (inner) {
    // Translate such that tree nodes appear centered in collapsed 50px strip
    var collapsedH = 50
    var translateY = zNodeX + sliderW + Math.round(collapsedH / 2)
    inner.style.transform = 'translate(0, ' + translateY + 'px) rotate(-90deg)'
    inner.style.width = footH + 'px'
  }

  // Center camera with smooth animation on navigation
  var nodeY = idx < 0 ? rootY : (zNode + idx * zGrid)
  var camWindow = _footerWrap.clientWidth || window.innerWidth || 1200
  var targetCamY = Math.round(nodeY - camWindow / 2)

  if (_footerAnimId) { cancelAnimationFrame(_footerAnimId); _footerAnimId = null }
  if (prevIdx === -1 || prevIdx === idx) {
    _footerCamY = targetCamY
    applyCamera()
  } else {
    animateFooterCam(targetCamY, 200)
  }
}

var nodeProps = function(move) {
  var color = [238, 238, 238]
  if (!move) return { fill: 'rgb(238,238,238)' }

  var ma = move.moveAnnotation
  var na = move.nodeAnnotation
  var hasComment = !!(move.comment)
  var hasName = !!(move.nodeName)

  if (ma && ma.type === 'BM') color = [240, 35, 17]
  else if (ma && ma.type === 'DO') color = [146, 39, 143]
  else if (ma && ma.type === 'IT') color = [72, 134, 213]
  else if (ma && ma.type === 'TE') color = [89, 168, 15]
  else if (na || hasComment || hasName) color = [255, 174, 61]

  return { fill: 'rgb(' + color.join(',') + ')' }
}

var nodePath = function(cx, cy, r) {
  var d = r * 2
  return 'M ' + cx + ' ' + cy + ' m ' + (-r) + ' 0 a ' + r + ' ' + r + ' 0 1 0 ' + d + ' 0 a ' + r + ' ' + r + ' 0 1 0 ' + (-d) + ' 0'
}

var diamondPath = function(cx, cy, r) {
  return 'M ' + cx + ' ' + (cy - r) + ' L ' + (cx + r) + ' ' + cy + ' L ' + cx + ' ' + (cy + r) + ' L ' + (cx - r) + ' ' + cy + ' Z'
}

var render = function() {
  if (!_svgWrap || typeof state === 'undefined' || !state) return
  var moves = state.sgfMoves || []
  var idx = state.currentMoveIndex
  if (idx === _lastIndex && _zoom === _lastZoom) return
  _lastIndex = idx
  _lastZoom = _zoom
  _treeCurIdx = idx

  if (!moves.length) {
    _svgWrap.innerHTML = ''
    _sliderSpan.textContent = '0'
    _sliderSpan.style.top = '0%'
    _treeCurIdx = -1
    renderFooterTree()
    return
  }

  var count = moves.length
  _viewW = _svgWrap.clientWidth || 120
  _viewH = _svgWrap.clientHeight || 80

  var zGrid = _gridSize * _zoom
  var zNode = _nodeSize * _zoom
  var zCur = zNode * _curScale
  var zNodeX = Math.round(zGrid * 1.5)

  _totalH = zNode + zGrid + zCur + (count - 1) * zGrid + zNode

  var rootY = zNode - zGrid

  var parts = []
  parts.push('<svg width="' + _viewW + '" height="' + _viewH + '" style="display:block">')

  var pts = []
  // Root to first move
  if (count > 0) {
    pts.push(zNodeX + ',' + rootY + ' ' + zNodeX + ',' + (zNode + 0 * zGrid))
  }
  // Between moves
  for (var i = 0; i < count - 1; i++) {
    var y1 = zNode + i * zGrid
    var y2 = zNode + (i + 1) * zGrid
    pts.push(zNodeX + ',' + y1 + ' ' + zNodeX + ',' + y2)
  }
  if (pts.length) {
    parts.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#ccc" stroke-width="1"></polyline>')
  }

  parts.push('<g>')
  // Root diamond node — clickable via onclick attribute
  var isRootCur = (idx === -1)
  parts.push('<path d="' + diamondPath(zNodeX, rootY, zNode) + '" class="node' + (isRootCur ? ' current' : '') + '" fill="rgb(238,238,238)" data-idx="-1" style="cursor:pointer"></path>')
  // Move nodes
  for (var i = 0; i < count; i++) {
    var isCur = i === idx
    var r = zNode * (isCur ? _curScale : 1)
    var y = zNode + i * zGrid
    var move = moves[i] || {}
    var p = nodeProps(move)
    var cls = 'node' + (isCur ? ' current' : '')
    parts.push('<path d="' + nodePath(zNodeX, y, r) + '" class="' + cls + '" fill="' + p.fill + '" data-idx="' + i + '"></path>')
  }
  parts.push('</g></svg>')

  _svgWrap.innerHTML = parts.join('')

  var sty = document.createElement('style')
  sty.setAttribute('data-cam', '')
  _svgWrap.appendChild(sty)

  centerOnNode(idx, _animateNext)
  _animateNext = false

  if (!_initialCentered || _viewW <= 120) {
    setTimeout(function() {
      _viewW = _svgWrap.clientWidth
      _viewH = _svgWrap.clientHeight
      centerOnNode(typeof state !== 'undefined' && state ? state.currentMoveIndex : idx, false)
    }, 50)
  }

  if (count > 1) {
    var pct = idx < 0 ? 0 : (idx / (count - 1)) * 100
    _sliderSpan.textContent = idx < 0 ? 0 : idx + 1
    _sliderSpan.style.top = pct + '%'
  } else {
    _sliderSpan.textContent = idx < 0 ? '0' : '1'
    _sliderSpan.style.top = '50%'
  }

  renderFooterTree()
}

var initFooterTree = function() {
  if (_footerWrap) return
  var footer = document.querySelector('footer.app-footer') || document.getElementById('replay-timeline-wrap');
  if (!footer) return
  _footerWrap = document.createElement('div')
  _footerWrap.id = 'gt-footer-tree'
  footer.insertBefore(_footerWrap, footer.firstChild)

  // Switch footer to dark tree mode
  _footerText = footer.querySelector('p')
  if (_footerText) _footerText.style.display = 'none'
  footer.classList.add('tree-active')

  // Click on nodes
  _footerWrap.addEventListener('click', function(e) {
    if (_fDrag) { _fDrag = false; return }
    var el = e.target.closest('.fnode')
    if (!el) return
    var i = parseInt(el.getAttribute('data-idx'))
    if (!isNaN(i) && typeof goToMove === 'function') goToMove(i)
  })

  // Prev/next buttons
  _footerWrap.addEventListener('click', function(e) {
    var t = e.target
    if (t.classList.contains('fprev')) { e.preventDefault(); navigate(state.currentMoveIndex - 1) }
    if (t.classList.contains('fnext')) { e.preventDefault(); navigate(state.currentMoveIndex + 1) }
  })

  // Click on slider track
  _footerWrap.addEventListener('mousedown', function(e) {
    var t = e.target.closest('.finner')
    if (t) {
      var count = (state.sgfMoves || []).length
      if (count < 2) return
      var rect = t.getBoundingClientRect()
      var pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      goToMove(Math.round(pct * (count - 1)))
    }
  })

  // Drag
  _footerWrap.addEventListener('mousedown', function(e) {
    if (e.button === 0) _footerMouseDown = true
    if (e.target.closest('.fprev, .fnext, .finner')) return
    _fDrag = false
    _fDragData = { startX: e.clientX, baseCam: _footerCamY }
  })

  // Wheel navigation / zoom (on footer)
  _footerWrap.addEventListener('wheel', function(e) {
    e.preventDefault()
    if (_footerMouseDown) {
      var oldZoom = _zoom
      _zoom *= (1 - e.deltaY * 0.001)
      _zoom = Math.max(0.5, Math.min(2.0, _zoom))
      if (_zoom !== oldZoom) {
        renderFooterTree()
        if (_svgWrap) { _lastZoom = -1; render() }
      }
      return
    }
    if (typeof goToMove !== 'function' || typeof state === 'undefined' || !state) return
    var count = (state.sgfMoves || []).length
    if (!count) return
    var dir = e.deltaY > 0 ? 1 : -1
    var cur = state.currentMoveIndex
    goToMove(Math.max(-1, Math.min(count - 1, cur + dir)))
  }, { passive: false })
}

// Clean up footer drag and zoom on mouseup
document.addEventListener('mouseup', function() {
  _fDragData = null
  _footerMouseDown = false
})

// Always-active footer tree drag-pan (works without Study Mode)
document.addEventListener('mousemove', function(e) {
  if (_fDragData) {
    var dx = e.clientX - _fDragData.startX
    if (Math.abs(dx) > 3) _fDrag = true
    if (_fDrag) {
      _footerCamY = _fDragData.baseCam - dx
      applyCamera()
    }
  }
})

var buildDOM = function() {
  _container.innerHTML = ''
  _container.className = 'graphproperties'

  _svgWrap = document.createElement('section')
  _svgWrap.id = 'gt-graph'
  _container.appendChild(_svgWrap)

  var slider = document.createElement('section')
  slider.id = 'gt-slider'

  _prevBtn = document.createElement('a')
  _prevBtn.href = '#'
  _prevBtn.className = 'prev'
  _prevBtn.textContent = '\u25B2'

  _slidingArea = document.createElement('div')
  _slidingArea.className = 'inner'

  _sliderSpan = document.createElement('span')
  _sliderSpan.textContent = '0'

  _nextBtn = document.createElement('a')
  _nextBtn.href = '#'
  _nextBtn.className = 'next'
  _nextBtn.textContent = '\u25BC'

  _slidingArea.appendChild(_sliderSpan)
  slider.appendChild(_prevBtn)
  slider.appendChild(_slidingArea)
  slider.appendChild(_nextBtn)
  _container.appendChild(slider)

  _prevBtn.addEventListener('mousedown', function(e) {
    e.preventDefault()
    navigate(state.currentMoveIndex - 1)
  })
  _nextBtn.addEventListener('mousedown', function(e) {
    e.preventDefault()
    navigate(state.currentMoveIndex + 1)
  })

  _slidingArea.addEventListener('mousedown', function(e) {
    if (typeof goToMove !== 'function' || typeof state === 'undefined' || !state) return
    var count = (state.sgfMoves || []).length
    if (count < 2) return
    var rect = _slidingArea.getBoundingClientRect()
    var pct = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    goToMove(Math.round(pct * (count - 1)))
  })

  _svgWrap.addEventListener('wheel', function(e) {
    e.preventDefault()
    // Left-click hold + scroll = zoom
    if (_mouseDown === 0) {
      var oldZoom = _zoom
      _zoom *= (1 - e.deltaY * 0.001)
      _zoom = Math.max(0.3, Math.min(3.0, _zoom))
      if (_zoom !== oldZoom) render()
      return
    }
    // Plain scroll = navigate
    if (typeof goToMove !== 'function' || typeof state === 'undefined' || !state) return
    var count = (state.sgfMoves || []).length
    if (!count) return
    var dir = e.deltaY > 0 ? 1 : -1
    goToMove(Math.max(0, Math.min(count - 1, _treeCurIdx + dir)))
  }, { passive: false })

  _svgWrap.addEventListener('mousedown', function(e) {
    _mouseDown = e.button
    _drag = false
    _svgWrap.style.cursor = 'grabbing'
  })

  _svgWrap.addEventListener('click', function(e) {
    if (_drag) {
      _drag = false
      e.stopPropagation()
      return
    }
    var el = e.target.closest('.node')
    if (!el) return
    var i = parseInt(el.getAttribute('data-idx'))
    if (!isNaN(i) && typeof goToMove === 'function') goToMove(i)
  }, { capture: true })

  document.addEventListener('mousemove', function(e) {
  var zGrid = _gridSize * _zoom
    var zNode = _nodeSize * _zoom
    var zNodeX = Math.round(zGrid * 1.5)

    if (_mouseDown === 0) {
      if (e.movementX !== 0 || e.movementY !== 0) _drag = true
      _camX = Math.max(-_viewW * 2, Math.min(_viewW * 2, _camX - e.movementX))
      _camY = _camY - e.movementY
      if (_animId) { cancelAnimationFrame(_animId); _animId = null }
      applyCamera()
    }
    if (!_svgWrap) return
    var rect = _svgWrap.getBoundingClientRect()
    var mx = e.clientX - rect.left + _camX
    var my = e.clientY - rect.top + _camY
    _svgWrap.querySelectorAll('.node').forEach(function(el) {
      var i = parseInt(el.getAttribute('data-idx'))
      if (isNaN(i)) return
      var ny = zNode + i * zGrid
      el.classList.toggle('hover', Math.abs(mx - zNodeX) < zGrid / 2 && Math.abs(my - ny) < zGrid / 2)
    })
  })

  document.addEventListener('mouseup', function() {
    _mouseDown = -1
    _drag = false
  })
}

var _hookGoToMove = function() {
  if (typeof goToMove !== 'function') return
  var orig = goToMove
  goToMove = function(idx) {
    orig(idx)
    _animateNext = true
    setTimeout(render, 0)
  }
}

var _pollId = setInterval(function() {
  if (!_container || !_container.parentNode) return
  if (typeof state === 'undefined' || !state) return
  if (state.currentMoveIndex !== _lastIndex) {
    _animateNext = true
    render()
  }
}, 100)

var onResize = function() {
  _lastIndex = -1
  _lastZoom = -1
  render()
}

// Auto-init footer tree when SGF data loads (no Study Mode dependency)
var _footerPollId = setInterval(function() {
  if (typeof state === 'undefined' || !state) return
  if (!_footerWrap) {
    if (state.sgfMoves && state.sgfMoves.length > 0 && (document.querySelector('footer.app-footer') || document.getElementById('replay-timeline-wrap'))) {
      initFooterTree()
      renderFooterTree()
    }
    return
  }
  if (state.currentMoveIndex !== _footerLastIdx) {
    renderFooterTree()
  }
}, 100)

window.GameTree = {
  init: function(container) {
    _container = container
    buildDOM()
    initFooterTree()
    _hookGoToMove()
    window.addEventListener('resize', onResize)
    setTimeout(render, 100)
  },
  renderFooterTree: function() {
    renderFooterTree()
  }
}

})()
