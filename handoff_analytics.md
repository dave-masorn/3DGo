# Analytics Sub-project Hand-off

This document summarizes the recent architectural changes, layout fixes, and feature implementations applied to the `analytics` sub-project (`baduk-notes/analytics/`). It serves as a context guide for future agents.

## 1. Project Context
- **Target**: A 3D WebGL-based Go game analyzer built with `Three.js` (`app.js`, `main.html`, `analytics.css`).
- **Goal**: Ensure the mobile UI is perfectly responsive, behaves like a native app, and accurately ports desktop features into the mobile layout.
- **Current Version**: `0.2.056`

## 2. Layout & CSS Architecture Fixes
We resolved severe layout bugs on mobile and tablet devices where the 3D board container would ignore CSS `aspect-ratio` rules, resulting in tall rectangular containers and massive empty visual gaps rendered by WebGL.

- **Javascript Aspect-Ratio Enforcement**: Bypassed CSS entirely for mobile boards. In `app.js` (`window.addEventListener('resize')`), we explicitly read `clientWidth` and enforce `container.style.height = container.clientWidth + 'px'` for `< 1024px` windows, forcing an unbreakable mathematical square.
- **Flexbox Overhaul**:
  - `.col-center` is set to `flex: none !important; gap: 0 !important;` to perfectly snap widgets flush against the board without invisible stretching.
  - `.col-right` is set to `flex: 1; display: flex; flex-direction: column;` to stretch and consume all remaining vertical space.
  - `.col-right > .widget` is set to `flex: 1`. This stretches the active widget's dark background down to the bottom tabs, completely eliminating empty "dead space" at the bottom of tall phone screens.
  - `.mobile-board-borders` padding was removed to snap the board perfectly edge-to-edge.
  - Natural vertical scrolling was enabled across stacked layouts (`body { overflow-y: auto !important; }`).

## 3. New Features: Territory Estimation
We ported the desktop Territory Estimation UI into the 3D Analytics dashboard.

- **Score Estimate Table**: Completely replaced the old 1D `defragChart` (pie chart) inside `#tab-panel-territory` with a fully styled, dark-mode `Score Estimate` table (matching `img 2` mockups). 
- **Javascript Logic**: Updated `app.js` to calculate `bTotalTerr` and `wTotalTerr` (incorporating area, captures, dead stones, and komi) and dynamically inject them into the HTML table upon calculation.
- **3D Heatmap Rendering**: 
  - The Analytics app lacked the on-board heatmap present in the desktop's 2D canvas. 
  - Built `updateTerritoryOverlay(areaMap)` in `app.js`.
  - It iterates over the AI's `estResult.areaMap` and dynamically spawns a `THREE.Group` of semi-transparent black and white `THREE.Mesh` squares, perfectly overlaying the 3D board grid.
  - Added cleanup logic to `switchTab()` so the 3D territory heatmap gracefully disappears when the user navigates away to other tabs (e.g., Combat Volatility).

## 4. Next Steps & Known State
- The UI is currently stable and highly responsive across desktop, tablet, and mobile.
- Git commits up to version `0.2.056` have been successfully pushed to the `main` branch.
- Any future widgets added to `.col-right` should adhere to the established flexbox rules to ensure they stretch properly without breaking the bottom-tab layout.
