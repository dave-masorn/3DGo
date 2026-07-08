# OpenCode Session — 2026-07-09

## Goal

Build a fully offline Go playing/analysis app powered by KataGo, deployable to mobile app stores.

## Constraints & Preferences

- Must work 100% offline.
- App size must be reasonable for App Store / Play Store distribution (259 MB model is too large to bundle).
- User wants to build their own app (not just use an existing GUI), integrating KataGo AI.

---

## Progress

### Step 1 — HTTrack Mirror of katagui.baduk.club

Partially worked. Most pages and assets were mirrored, but the board UI was non-functional because the site relies on JavaScript ES module imports that HTTrack cannot resolve:

```
Uncaught TypeError: Module name, 'sgf' did not
    resolve to a valid URL, 'module' is not set
```

Manually fetched the missing JS modules (`appfuncs.js`, `sgf.js`) from the live site and swapped Bootstrap CSS to local. Still broken — kataGUI is a dynamic Flask web app requiring a backend.

**Conclusion**: HTTrack cannot fully mirror a dynamic web app. Need a different approach.

### Step 2 — Self-Host kataGUI

Cloned the repo:

```bash
git clone https://github.com/hauensteina/katagui.git \
    ~/AntiGravity/katagui-selfhosted
```

**Dependencies installed**:

- PostgreSQL 16 (via Homebrew) — `brew install postgresql@16`
- Redis (via Homebrew) — `brew install redis`
- Both services started and set to launch on login.

**Python environment**:

```bash
cd ~/AntiGravity/katagui-selfhosted
python3.13 -m venv venv
source venv/bin/activate
pip install flask flask-sqlalchemy flask-sockets \
            psycopg2-binary sqlalchemy redis \
            gunicorn gevent gevent-websocket \
            python-dotenv markdown
```

**Fix needed** — `postgres.py` line 342 had a `%` that wasn't escaped for Python string formatting:

```python
# Before (broken):
    sql = text("""
        SELECT * FROM graphs
        WHERE user_id = :uid AND %(name_col)s ILIKE :pattern
    """)

# After (fixed):
    sql = text("""
        SELECT * FROM graphs
        WHERE user_id = :uid AND %%(%(name_col)s)s ILIKE :pattern
    """)
```

**Database setup**:

```sql
CREATE DATABASE katagui;
```

Tables and views initialized from the repo's SQL schema.

**`.env` configuration**:

```
DATABASE_URL=postgresql://localhost/katagui
FLASK_DEBUG=1
SECRET_KEY=<generated>
```

**Running**:

```bash
gunicorn -k flask_sockets.worker -b 127.0.0.1:8000 app:app
```

Successfully served on `http://127.0.0.1:8000/`.

**Conclusion**: kataGUI works but requires a full server stack (PostgreSQL + Redis + Python backend). Overkill for a mobile app.

### Step 3 — Direct KataGo Integration (Chosen Path)

**Decision**: Use KataGo directly as a subprocess (GTP or Analysis Engine) instead of self-hosting kataGUI. Simpler, fully offline, no server dependencies.

**KataGo v1.16.4 installed via Homebrew**:

```bash
brew install katago
```

**Network weights downloaded** (~/AntiGravity/KataGUI/katago_data/):

```
kata1-b28c512nbt-s13255194368-d5935380940.bin.gz
    259 MB, ~14106 Elo (latest as of July 2026)
```

**Config files** downloaded from KataGo GitHub:
- `gtp_config.cfg`
- `analysis_config.cfg`

**GTP mode test** — works:

```bash
echo "genmove B" | katago gtp -model <model> -config <config>
```

Output example: `= F5`

**Analysis Engine test** — works (JSON output with winrate, top moves, PV, score lead, ownership).

### Step 4 — Python Integration Example

File: `~/AntiGravity/KataGUI/katago_data/integration_example.py`

```python
import subprocess, json

KATAGO = "/opt/homebrew/bin/katago"
MODEL   = "kata1-b28c512nbt-s13255194368-d5935380940.bin.gz"
GTP_CONFIG = "gtp_config.cfg"
ANALYSIS_CONFIG = "analysis_config.cfg"

# ── GTP mode (text protocol) ─────────────────────────────
def gtp_move(gtp_proc, command):
    gtp_proc.stdin.write(command + "\n")
    gtp_proc.stdin.flush()
    line = ""
    while True:
        line = gtp_proc.stdout.readline().strip()
        if line and line != "":
            break
    return line

gtp_proc = subprocess.Popen(
    [KATAGO, "gtp", "-model", MODEL, "-config", GTP_CONFIG],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL, text=True, bufsize=1
)
gtp_move(gtp_proc, "boardsize 19")
gtp_move(gtp_proc, "komi 6.5")
gtp_move(gtp_proc, "clear_board")
gtp_move(gtp_proc, "genmove B")   # => "= F5"
gtp_proc.terminate()

# ── Analysis Engine mode (JSON) ──────────────────────────
analysis_proc = subprocess.Popen(
    [KATAGO, "analysis", "-model", MODEL, "-config", ANALYSIS_CONFIG],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL, text=True, bufsize=1
)

def query(reports, settings=None):
    req = {
        "id": "analysis_1", "moves": reports,
        "rules": "tromp-taylor", "komi": 6.5,
        "maxVisits": 800, "includeOwnership": True
    }
    if settings:
        req.update(settings)
    analysis_proc.stdin.write(json.dumps(req) + "\n")
    analysis_proc.stdin.flush()
    return json.loads(analysis_proc.stdout.readline())

result = query([])  # initial empty board
# => {"winrate": 0.5, "scoreLead": 0.0, "moveInfos": [...], "ownership": [...]}
analysis_proc.terminate()
```

---

## Network Strategy for Mobile (Decision Made)

| Option | Size | Strength | How |
|---|---|---|---|
| **Bundle: Lionffen b6c64** (default) | ~30 MB | Competitive with historical 10-block nets; runs much faster | Include in app bundle |
| **Optional DL: Latest b28c512nbt** (upgrade) | 259 MB | ~14106 Elo (top-tier) | Download on first launch with user consent |

The Lionffen b6c64 is ideal for mobile — tiny, fast, and still superhuman. Source: https://katagotraining.org/extra_networks/

---

## App Framework Decision

**Recommendation: Flutter (cross-platform)**

Rationale:

| Factor | Flutter | React Native | SwiftUI | Kotlin MP |
|---|---|---|---|---|
| Cross-platform | iOS + Android | iOS + Android | iOS only | iOS + Android |
| C++ FFI (KataGo) | **Excellent** via `dart:ffi` | Difficult (native modules) | **Native** via Swift→ObjC→C++ | Good via JNI/cinterop |
| KataGo in-process | **Yes** — compile KataGo as a static lib, call via FFI | No (subprocess only) | Yes | Yes |
| GTP pipe support | Easy (`Process` + stdin/stdout) | Subprocess support limited | Built-in `Process` | `java.lang.Process` |
| iOS subprocess | **Not allowed** by App Store | Blocked | Blocked | Blocked |
| Android subprocess | Allowed | Allowed | N/A | Allowed |

**The critical issue**: iOS does not allow spawning arbitrary subprocesses. On iOS, KataGo **must** be compiled as a static/dynamic library and called via C FFI. On Android, you can either spawn it as a subprocess or embed via JNI.

Flutter handles both: `dart:ffi` on iOS (call KataGo C API directly), and either FFI or `Process.run` on Android.

---

## Relevant Files

| Path | Description |
|---|---|
| `~/AntiGravity/katagui-selfhosted/` | Self-hosted kataGUI repo (Flask/Python) |
| `~/AntiGravity/KataGUI/katago_data/kata1-b28c512nbt-s13255194368-d5935380940.bin.gz` | Downloaded network (259 MB) |
| `~/AntiGravity/KataGUI/katago_data/gtp_config.cfg` | GTP config for playing |
| `~/AntiGravity/KataGUI/katago_data/analysis_config.cfg` | Analysis engine config |
| `~/AntiGravity/KataGUI/katago_data/integration_example.py` | Working Python integration example |
| `~/AntiGravity/KataGUI/katagui.baduk.club/` | HTTrack mirror (partial, not functional) |
| `~/AntiGravity/baduk-notes/analytics/katago/opencode-session-2026-07-09.md` | **This file** |

## Key URLs

| URL | Purpose |
|---|---|
| https://katagotraining.org/networks/ | Current run networks (b28, b40) |
| https://katagotraining.org/extra_networks/ | Special/alternative networks (b6c64, b24c64, etc.) |
| https://github.com/lightvector/KataGo | Official KataGo repo |
| https://github.com/hauensteina/katagui | kataGUI web interface |
| https://d3dndmfyhecmj0.cloudfront.net/g170/neuralnets/index.html | Old g170 run extended training nets (b10c128, b15c192) |
