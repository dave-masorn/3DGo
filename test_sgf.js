const fs = require('fs');
const text = fs.readFileSync('/Users/davemasorn/AntiGravity/baduk-notes/analytics/2ipk-gokifu-20160309-AlphaGo-Lee_Sedol.sgf', 'utf8');

const moveRegex = /;([BW])\[([a-z]{2})?\]/g;
let match;
let moveHistory = [];

while ((match = moveRegex.exec(text)) !== null) {
  const color = match[1]; // B or W
  const coords = match[2];
  if (coords) {
    moveHistory.push({ color, coords });
  }
}
console.log(`Matched ${moveHistory.length} moves.`);
