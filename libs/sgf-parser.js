/**
 * SgfEngine - SGF FF[4] Parser and Serializer (Go / GM[1] focus)
 *
 * Spec: https://red-bean.com/sgf/sgf4.html
 * Go:   https://red-bean.com/sgf/go.html
 *
 * Handles nested variations, escaped property values, compressed point lists,
 * Go coordinates up to 52x52, and preserves unknown properties for round-trip.
 */

const SgfEngine = (function() {

    const MOVE_PROPS = new Set(['B', 'W', 'KO', 'MN', 'BL', 'WL', 'OB', 'OW', 'BM', 'TE', 'DO', 'IT']);
    const SETUP_PROPS = new Set(['AB', 'AW', 'AE', 'PL']);
    const ROOT_PROPS = new Set(['AP', 'CA', 'FF', 'GM', 'ST', 'SZ']);
    const GAME_INFO_PROPS = new Set([
        'AN', 'BR', 'BT', 'CP', 'DT', 'EV', 'GN', 'GC', 'ON', 'OT',
        'PB', 'PC', 'PW', 'RE', 'RO', 'RU', 'SO', 'TM', 'US', 'WR', 'WT',
        'HA', 'KM'
    ]);
    const MARKUP_POINT_PROPS = new Set(['TR', 'SQ', 'CR', 'MA', 'SL', 'TB', 'TW']);
    const STANDARD_PROPS = new Set([
        ...MOVE_PROPS, ...SETUP_PROPS, ...ROOT_PROPS, ...GAME_INFO_PROPS,
        ...MARKUP_POINT_PROPS,
        'C', 'N', 'V', 'DM', 'GB', 'GW', 'HO', 'UC',
        'AR', 'LB', 'LN', 'DD', 'VW', 'FG', 'PM'
    ]);

    function letterToIndex(ch) {
        if (!ch || ch.length !== 1) return -1;
        const code = ch.charCodeAt(0);
        if (code >= 97 && code <= 122) return code - 97;
        if (code >= 65 && code <= 90) return code - 65 + 26;
        return -1;
    }

    function indexToLetter(idx) {
        if (idx < 0 || idx > 51) return null;
        if (idx < 26) return String.fromCharCode(97 + idx);
        return String.fromCharCode(65 + (idx - 26));
    }

    function parseBoardSize(szValues) {
        const fallback = { width: 19, height: 19 };
        if (!szValues || szValues.length === 0) return fallback;
        const raw = szValues[0];
        if (raw.includes(':')) {
            const parts = raw.split(':');
            const w = parseInt(parts[0], 10);
            const h = parseInt(parts[1], 10);
            if (isNaN(w) || isNaN(h) || w < 1 || h < 1) return fallback;
            return { width: w, height: h };
        }
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 1) return fallback;
        return { width: n, height: n };
    }

    function parseGoPoint(pointStr, boardWidth, boardHeight) {
        if (pointStr === '' || pointStr == null) {
            return { c: -1, r: -1, isPass: true };
        }
        if (pointStr === 'tt' && boardWidth <= 19 && boardHeight <= 19) {
            return { c: -1, r: -1, isPass: true };
        }
        if (pointStr.length !== 2) return null;
        const c = letterToIndex(pointStr[0]);
        const r = letterToIndex(pointStr[1]);
        if (c < 0 || r < 0 || c >= boardWidth || r >= boardHeight) return null;
        return { c, r, isPass: false };
    }

    function formatGoPoint(c, r) {
        const col = indexToLetter(c);
        const row = indexToLetter(r);
        if (col == null || row == null) return null;
        return col + row;
    }

    function expandPointValue(val, boardWidth, boardHeight) {
        if (val == null || val === '') return [];
        if (val.includes(':')) {
            const parts = val.split(':');
            if (parts.length !== 2) return [];
            const ul = parseGoPoint(parts[0], boardWidth, boardHeight);
            const lr = parseGoPoint(parts[1], boardWidth, boardHeight);
            if (!ul || !lr || ul.isPass || lr.isPass) return [];
            const cMin = Math.min(ul.c, lr.c);
            const cMax = Math.max(ul.c, lr.c);
            const rMin = Math.min(ul.r, lr.r);
            const rMax = Math.max(ul.r, lr.r);
            const points = [];
            for (let r = rMin; r <= rMax; r++) {
                for (let c = cMin; c <= cMax; c++) {
                    points.push({ c, r });
                }
            }
            return points;
        }
        const pt = parseGoPoint(val, boardWidth, boardHeight);
        if (!pt || pt.isPass) return [];
        return [{ c: pt.c, r: pt.r }];
    }

    function expandPointList(values, boardWidth, boardHeight) {
        if (!values) return [];
        const seen = new Set();
        const out = [];
        values.forEach(val => {
            expandPointValue(val, boardWidth, boardHeight).forEach(pt => {
                const key = pt.c + ',' + pt.r;
                if (!seen.has(key)) {
                    seen.add(key);
                    out.push(pt);
                }
            });
        });
        return out;
    }

    function validateNodeProperties(props) {
        const warnings = [];
        const hasMove = props.B || props.W;
        const setupPresent = !!(props.AB || props.AW || props.AE || props.PL);
        if (hasMove && setupPresent) {
            warnings.push('Node mixes move and setup properties (illegal in FF[4]).');
        }
        if (props.B && props.W) {
            warnings.push('Node contains both B and W properties (illegal in FF[4]).');
        }
        if (props.KO && !props.B && !props.W) {
            warnings.push('KO property without B or W move (illegal in FF[4]).');
        }
        return warnings;
    }

    class SgfLexer {
        constructor(input) {
            this.input = input;
            this.pos = 0;
            this.length = input.length;
        }

        peek() {
            return this.pos < this.length ? this.input[this.pos] : null;
        }

        next() {
            return this.pos < this.length ? this.input[this.pos++] : null;
        }

        skipWhitespace() {
            while (this.pos < this.length && /\s/.test(this.input[this.pos])) {
                this.pos++;
            }
        }
    }

    function parseProperty(lexer) {
        lexer.skipWhitespace();
        let propIdent = '';

        while (lexer.peek() && /[A-Z]/.test(lexer.peek())) {
            propIdent += lexer.next();
        }

        if (propIdent === '') return null;

        const propValues = [];
        lexer.skipWhitespace();

        while (lexer.peek() === '[') {
            lexer.next();
            let val = '';
            while (lexer.peek() !== null) {
                const c = lexer.next();
                if (c === '\\') {
                    const escaped = lexer.next();
                    if (escaped === '\n' || escaped === '\r') {
                        if (escaped === '\r' && lexer.peek() === '\n') {
                            lexer.next();
                        }
                    } else if (escaped !== null) {
                        val += escaped;
                    }
                } else if (c === ']') {
                    break;
                } else {
                    val += c;
                }
            }
            propValues.push(val);
            lexer.skipWhitespace();
        }

        if (propValues.length === 0) {
            throw new Error('SGF Parse Error: Property ' + propIdent + ' has no value.');
        }

        return { key: propIdent, values: propValues };
    }

    function parseNode(lexer) {
        lexer.skipWhitespace();
        if (lexer.peek() !== ';') return null;
        lexer.next();

        const properties = {};

        while (true) {
            lexer.skipWhitespace();
            if (!lexer.peek() || !/[A-Z]/.test(lexer.peek())) break;

            const prop = parseProperty(lexer);
            if (prop) {
                if (properties[prop.key]) {
                    console.warn('SGF Parse Warning: Duplicate property ' + prop.key + ' in node; merging values.');
                    properties[prop.key] = properties[prop.key].concat(prop.values);
                } else {
                    properties[prop.key] = prop.values;
                }
            } else {
                break;
            }
        }

        validateNodeProperties(properties).forEach(w => console.warn('SGF Parse Warning: ' + w));

        return { properties, children: [] };
    }

    function parseTree(lexer) {
        lexer.skipWhitespace();
        if (lexer.peek() !== '(') return null;
        lexer.next();

        const tree = { nodes: [], children: [] };

        while (true) {
            lexer.skipWhitespace();
            if (lexer.peek() === ';') {
                const node = parseNode(lexer);
                if (node) tree.nodes.push(node);
            } else {
                break;
            }
        }

        while (true) {
            lexer.skipWhitespace();
            if (lexer.peek() === '(') {
                const childTree = parseTree(lexer);
                if (childTree) tree.children.push(childTree);
            } else {
                break;
            }
        }

        lexer.skipWhitespace();
        if (lexer.peek() === ')') {
            lexer.next();
        } else {
            console.warn('SGF Parse Warning: Missing closing parenthesis for GameTree.');
        }

        return tree;
    }

    function parseSgfCollection(sgfStr) {
        const lexer = new SgfLexer(sgfStr);
        lexer.skipWhitespace();
        const trees = [];
        while (lexer.peek() === '(') {
            trees.push(parseTree(lexer));
        }
        return trees;
    }

    function parseSgf(sgfStr) {
        const trees = parseSgfCollection(sgfStr);
        if (trees.length === 0) return null;
        if (trees.length > 1) {
            console.warn('SGF Parse Warning: Collection contains ' + trees.length + ' game trees; using the first.');
        }
        return trees[0];
    }

    function escapePropValue(str) {
        if (typeof str !== 'string') return str;
        return str
            .replace(/\\/g, '\\\\')
            .replace(/]/g, '\\]')
            .replace(/:/g, '\\:');
    }

    function writeNode(node) {
        let out = ';';
        for (const key in node.properties) {
            out += key;
            const values = node.properties[key];
            for (const val of values) {
                out += '[' + escapePropValue(val) + ']';
            }
        }
        return out;
    }

    function writeTree(tree) {
        let out = '(';
        for (const node of tree.nodes) {
            out += writeNode(node);
        }
        for (const child of tree.children) {
            out += writeTree(child);
        }
        out += ')';
        return out;
    }

    function writeCollection(trees) {
        return trees.map(writeTree).join('');
    }

    function extractMainLine(tree) {
        const moves = [];
        let currentTree = tree;
        while (currentTree) {
            for (const node of currentTree.nodes) {
                moves.push(node.properties);
            }
            if (currentTree.children && currentTree.children.length > 0) {
                currentTree = currentTree.children[0];
            } else {
                currentTree = null;
            }
        }
        return moves;
    }

    function cloneTree(tree) {
        if (!tree) return null;
        return {
            nodes: tree.nodes.map(n => ({
                properties: JSON.parse(JSON.stringify(n.properties)),
                children: n.children || []
            })),
            children: (tree.children || []).map(cloneTree)
        };
    }

    function applySetupProperties(board, props, boardWidth, boardHeight) {
        if (props.AE) {
            expandPointList(props.AE, boardWidth, boardHeight).forEach(pt => {
                if (board[pt.r] && board[pt.r][pt.c]) {
                    board[pt.r][pt.c].player = null;
                }
            });
        }
        if (props.AB) {
            expandPointList(props.AB, boardWidth, boardHeight).forEach(pt => {
                if (board[pt.r] && board[pt.r][pt.c]) {
                    board[pt.r][pt.c].player = 'B';
                }
            });
        }
        if (props.AW) {
            expandPointList(props.AW, boardWidth, boardHeight).forEach(pt => {
                if (board[pt.r] && board[pt.r][pt.c]) {
                    board[pt.r][pt.c].player = 'W';
                }
            });
        }
    }

    function parseMarkupProperties(props, boardWidth, boardHeight) {
        const annotations = [];
        const addPoints = (tag, type) => {
            if (!props[tag]) return;
            expandPointList(props[tag], boardWidth, boardHeight).forEach(pt => {
                annotations.push({ r: pt.r, c: pt.c, type });
            });
        };
        addPoints('TR', 'triangle');
        addPoints('SQ', 'square');
        addPoints('CR', 'circle');
        addPoints('MA', 'cross');
        addPoints('SL', 'selected');
        addPoints('CXR', 'red-circle');
        addPoints('CXG', 'green-circle');

        if (props.LB) {
            props.LB.forEach(val => {
                const colonIdx = val.indexOf(':');
                if (colonIdx < 1) return;
                const coordPart = val.substring(0, colonIdx);
                const label = val.substring(colonIdx + 1);
                expandPointValue(coordPart, boardWidth, boardHeight).forEach(pt => {
                    annotations.push({ r: pt.r, c: pt.c, type: 'label', label });
                });
            });
        }

        const territory = {
            black: props.TB ? expandPointList(props.TB, boardWidth, boardHeight) : [],
            white: props.TW ? expandPointList(props.TW, boardWidth, boardHeight) : []
        };

        return { annotations, territory };
    }

    function extractUnknownProperties(props) {
        const unknown = {};
        for (const key in props) {
            if (!STANDARD_PROPS.has(key)) {
                unknown[key] = props[key].slice();
            }
        }
        return unknown;
    }

    function mergeUnknownProperties(nodeProps, unknown) {
        if (!unknown) return nodeProps;
        const merged = Object.assign({}, nodeProps);
        for (const key in unknown) {
            merged[key] = unknown[key].slice();
        }
        return merged;
    }

    function annotationsToProperties(anns) {
        const props = {};
        if (!anns || anns.length === 0) return props;
        const tr = [], sq = [], cr = [], ma = [], sl = [], lb = [], cxr = [], cxg = [];
        anns.forEach(a => {
            const coord = formatGoPoint(a.c, a.r);
            if (!coord) return;
            switch (a.type) {
                case 'triangle': tr.push(coord); break;
                case 'square': sq.push(coord); break;
                case 'circle': cr.push(coord); break;
                case 'cross': ma.push(coord); break;
                case 'selected': sl.push(coord); break;
                case 'red-circle': cxr.push(coord); break;
                case 'green-circle': cxg.push(coord); break;
                case 'label': lb.push(coord + ':' + a.label); break;
            }
        });
        if (tr.length) props.TR = tr;
        if (sq.length) props.SQ = sq;
        if (cr.length) props.CR = cr;
        if (ma.length) props.MA = ma;
        if (sl.length) props.SL = sl;
        if (lb.length) props.LB = lb;
        if (cxr.length) props.CXR = cxr;
        if (cxg.length) props.CXG = cxg;
        return props;
    }

    /** Replace main-line sequence nodes in a cloned tree (preserves variations). */
    function replaceMainLineNodes(tree, nodePropertyList) {
        let currentTree = tree;
        let nodeIndex = 0;

        while (currentTree && nodeIndex < nodePropertyList.length) {
            for (let i = 0; i < currentTree.nodes.length && nodeIndex < nodePropertyList.length; i++) {
                currentTree.nodes[i].properties = JSON.parse(JSON.stringify(nodePropertyList[nodeIndex]));
                nodeIndex++;
            }
            if (nodeIndex >= nodePropertyList.length) break;
            if (currentTree.children && currentTree.children.length > 0) {
                currentTree = currentTree.children[0];
            } else {
                while (nodeIndex < nodePropertyList.length) {
                    currentTree.nodes.push({ properties: JSON.parse(JSON.stringify(nodePropertyList[nodeIndex])), children: [] });
                    nodeIndex++;
                }
            }
        }
        return tree;
    }

    return {
        parseSgf,
        parseSgfCollection,
        writeSgf: writeTree,
        writeCollection,
        extractMainLine,
        cloneTree,
        replaceMainLineNodes,
        letterToIndex,
        indexToLetter,
        parseBoardSize,
        parseGoPoint,
        formatGoPoint,
        expandPointValue,
        expandPointList,
        applySetupProperties,
        parseMarkupProperties,
        validateNodeProperties,
        extractUnknownProperties,
        mergeUnknownProperties,
        annotationsToProperties,
        MOVE_PROPS,
        SETUP_PROPS,
        STANDARD_PROPS
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SgfEngine;
} else if (typeof window !== 'undefined') {
    window.SgfEngine = SgfEngine;
}
