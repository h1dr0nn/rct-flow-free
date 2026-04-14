"""
Flow Free Level Generator v2 — Quality Puzzle Generation

Replaces v1's Hamiltonian-only approach with two strategies:

  A. Multi-seed round-robin growth (primary)
     Seeds are scattered across the grid. All paths grow simultaneously
     in round-robin, creating naturally interleaving color flows.

  B. Hamiltonian path with smart splitting (fallback)
     Generates a Hamiltonian path (Warnsdorff), then splits it with
     random cut-points that satisfy Manhattan distance constraints.

Both strategies are followed by:
  - Path merging (absorb paths < min_len into neighbors)
  - Path splitting (break oversized paths to hit target color count)
  - Quality filter (Manhattan distance, length variety, no loops)
  - Uniqueness solver (exactly 1 full-board solution, no short solutions)

Changes from v1:
  1. Round-robin growth → paths interleave instead of running in parallel
  2. Manhattan distance filter → no trivially close endpoints
  3. Real uniqueness check → count full-board solutions = 1
  4. Better path variety → mix of short and long paths
  5. Interior-biased Hamiltonian starts → less edge clustering
"""

import json
import random
import sys
import time
from pathlib import Path

sys.setrecursionlimit(200_000)

DIRS = [(0, 1), (1, 0), (0, -1), (-1, 0)]


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════

def make_grid(paths: list[list[tuple[int, int]]], w: int, h: int) -> list[list[int]]:
    grid = [[-1] * w for _ in range(h)]
    for i, p in enumerate(paths):
        for r, c in p:
            grid[r][c] = i
    return grid


def manhattan(ar: int, ac: int, br: int, bc: int) -> int:
    return abs(ar - br) + abs(ac - bc)


def count_turns(path: list[tuple[int, int]]) -> int:
    if len(path) < 3:
        return 0
    turns = 0
    for i in range(1, len(path) - 1):
        d1 = (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
        d2 = (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
        if d1 != d2:
            turns += 1
    return turns


# ═══════════════════════════════════════════════════════════════
# Strategy A — Multi-seed round-robin growth
# ═══════════════════════════════════════════════════════════════

def fill_grid_grow(w: int, h: int, num_seeds: int,
                   ) -> list[list[tuple[int, int]]] | None:
    """Fill grid by growing *num_seeds* paths from scattered seeds.

    Each growth round extends every active path by one cell (round-robin).
    Warnsdorff heuristic is used per-step to avoid creating isolated cells.

    Returns list of paths or None if the grid couldn't be fully filled.
    """
    total = w * h
    grid = [[-1] * w for _ in range(h)]
    unfilled: set[tuple[int, int]] = {(r, c) for r in range(h) for c in range(w)}

    # --- place seeds with spacing ≥ 2 Manhattan distance ---
    all_cells = list(unfilled)
    random.shuffle(all_cells)
    seeds: list[tuple[int, int]] = []
    for r, c in all_cells:
        if len(seeds) >= num_seeds:
            break
        if any(manhattan(r, c, sr, sc) < 2 for sr, sc in seeds):
            continue
        seeds.append((r, c))
    # relax spacing if not enough seeds found
    for r, c in all_cells:
        if len(seeds) >= num_seeds:
            break
        if (r, c) not in seeds:
            seeds.append((r, c))

    paths: list[list[tuple[int, int]]] = []
    for i, (r, c) in enumerate(seeds):
        paths.append([(r, c)])
        grid[r][c] = i
        unfilled.discard((r, c))

    # --- round-robin growth ---
    active = list(range(num_seeds))

    while unfilled and active:
        next_active: list[int] = []
        random.shuffle(active)

        for i in active:
            if not unfilled:
                break
            p = paths[i]
            extended = False
            # try both endpoints in random order
            endpoints = [len(p) - 1, 0]
            if random.random() < 0.5:
                endpoints.reverse()

            for ei in endpoints:
                r, c = p[ei]
                nbrs = [(r + dr, c + dc)
                        for dr, dc in DIRS if (r + dr, c + dc) in unfilled]
                if not nbrs:
                    continue
                # Warnsdorff: prefer neighbor with fewest remaining exits
                best = min(
                    nbrs,
                    key=lambda rc: (
                        sum(1 for dr, dc in DIRS
                            if (rc[0] + dr, rc[1] + dc) in unfilled
                            and (rc[0] + dr, rc[1] + dc) != (r, c)),
                        random.random(),
                    ),
                )
                nr, nc = best
                if ei == len(p) - 1:
                    p.append((nr, nc))
                else:
                    p.insert(0, (nr, nc))
                grid[nr][nc] = i
                unfilled.discard((nr, nc))
                extended = True
                break

            if extended:
                next_active.append(i)

        # rescue: if growth stalled but cells remain, extend any reachable endpoint
        if not next_active and unfilled:
            rescued = False
            for i in range(len(paths)):
                for ei in (len(paths[i]) - 1, 0):
                    r, c = paths[i][ei]
                    nbrs = [(r + dr, c + dc)
                            for dr, dc in DIRS if (r + dr, c + dc) in unfilled]
                    if nbrs:
                        nr, nc = random.choice(nbrs)
                        if ei == len(paths[i]) - 1:
                            paths[i].append((nr, nc))
                        else:
                            paths[i].insert(0, (nr, nc))
                        grid[nr][nc] = i
                        unfilled.discard((nr, nc))
                        next_active.append(i)
                        rescued = True
                        break
                if rescued:
                    break
            if not rescued:
                return None  # unreachable cells remain

        active = next_active

    return None if unfilled else paths


# ═══════════════════════════════════════════════════════════════
# Strategy B — Hamiltonian path + smart split (fallback)
# ═══════════════════════════════════════════════════════════════

def rand_hamilton(w: int, h: int) -> list[tuple[int, int]] | None:
    """Warnsdorff's heuristic with randomised tie-breaking."""
    visited = [[False] * w for _ in range(h)]
    path: list[tuple[int, int]] = []
    total = w * h

    def degree(r: int, c: int) -> int:
        return sum(
            1 for dr, dc in DIRS
            if 0 <= r + dr < h and 0 <= c + dc < w and not visited[r + dr][c + dc]
        )

    def dfs(r: int, c: int) -> bool:
        visited[r][c] = True
        path.append((r, c))
        if len(path) == total:
            return True
        neighbors = sorted(
            ((degree(r + dr, c + dc), random.random(), r + dr, c + dc)
             for dr, dc in DIRS
             if 0 <= r + dr < h and 0 <= c + dc < w and not visited[r + dr][c + dc]),
        )
        for _, _, nr, nc in neighbors:
            if dfs(nr, nc):
                return True
        visited[r][c] = False
        path.pop()
        return False

    # prefer interior starts to reduce edge-clustering
    starts = [(r, c) for r in range(h) for c in range(w)]
    starts.sort(
        key=lambda rc: min(rc[0], h - 1 - rc[0]) + min(rc[1], w - 1 - rc[1]),
        reverse=True,
    )
    for sr, sc in starts[:6]:
        visited = [[False] * w for _ in range(h)]
        path.clear()
        if dfs(sr, sc):
            return list(path)
    return None


def split_hamilton(
    hp: list[tuple[int, int]],
    num_colors: int,
    min_len: int,
    min_md: int,
    max_attempts: int = 500,
) -> list[list[tuple[int, int]]] | None:
    """Split a Hamiltonian path at random cut-points that satisfy constraints."""
    total = len(hp)
    if total < num_colors * min_len:
        return None

    for _ in range(max_attempts):
        cuts: list[int] = []
        lo = min_len
        ok = True
        for i in range(num_colors - 1):
            remaining_cuts = num_colors - 2 - i
            hi = total - min_len * (remaining_cuts + 1)
            if lo > hi:
                ok = False
                break
            cuts.append(random.randint(lo, hi))
            lo = cuts[-1] + min_len
        if not ok:
            continue

        segments: list[list[tuple[int, int]]] = []
        prev = 0
        bad = False
        for c in cuts + [total]:
            seg = hp[prev:c]
            md = manhattan(*seg[0], *seg[-1])
            if md < min_md:
                bad = True
                break
            segments.append(seg)
            prev = c
        if bad:
            continue

        # reject if one segment dominates
        if max(len(s) for s in segments) > total * 0.45:
            continue

        return segments

    return None


# ═══════════════════════════════════════════════════════════════
# Path adjustment — merge short, split long
# ═══════════════════════════════════════════════════════════════

def merge_short(
    paths: list[list[tuple[int, int]] | None],
    w: int, h: int,
    min_len: int,
) -> list[list[tuple[int, int]]]:
    """Merge paths shorter than *min_len* into a neighbour via endpoint adjacency."""
    grid = make_grid([p for p in paths if p is not None], w, h)
    # rebuild index map after removing Nones
    clean: list[list[tuple[int, int]]] = [p for p in paths if p is not None]
    grid = make_grid(clean, w, h)
    paths_mut: list[list[tuple[int, int]] | None] = list(clean)

    changed = True
    while changed:
        changed = False
        for i in range(len(paths_mut)):
            p = paths_mut[i]
            if p is None or len(p) >= min_len:
                continue
            merged = False
            for a_ei in (0, -1):
                ar, ac = p[a_ei]
                for dr, dc in DIRS:
                    nr, nc = ar + dr, ac + dc
                    if not (0 <= nr < h and 0 <= nc < w):
                        continue
                    j = grid[nr][nc]
                    if j < 0 or j == i or paths_mut[j] is None:
                        continue
                    q = paths_mut[j]
                    assert q is not None
                    new_path: list[tuple[int, int]] | None = None
                    if (nr, nc) == q[0]:
                        new_path = (list(reversed(p)) if a_ei == 0 else list(p)) + list(q)
                    elif (nr, nc) == q[-1]:
                        new_path = list(q) + (list(p) if a_ei == 0 else list(reversed(p)))
                    if new_path is not None:
                        for r2, c2 in p:
                            grid[r2][c2] = j
                        paths_mut[j] = new_path
                        paths_mut[i] = None
                        changed = True
                        merged = True
                        break
                if merged:
                    break

    result = [p for p in paths_mut if p is not None]
    return result


def split_longest(
    paths: list[list[tuple[int, int]]],
    w: int, h: int,
    target: int,
    min_len: int,
    min_md: int,
) -> list[list[tuple[int, int]]]:
    """Split the longest path to approach *target* path count."""
    while len(paths) < target:
        candidates = [(i, len(p)) for i, p in enumerate(paths)
                       if len(p) >= 2 * min_len]
        if not candidates:
            break
        candidates.sort(key=lambda x: -x[1])

        did_split = False
        for idx, _ in candidates:
            p = paths[idx]
            for _ in range(80):
                k = random.randint(min_len, len(p) - min_len)
                a, b = p[:k], p[k:]
                if (manhattan(*a[0], *a[-1]) >= min_md
                        and manhattan(*b[0], *b[-1]) >= min_md):
                    paths[idx] = a
                    paths.append(b)
                    did_split = True
                    break
            if did_split:
                break
        if not did_split:
            break
    return paths


# ═══════════════════════════════════════════════════════════════
# Quality filter
# ═══════════════════════════════════════════════════════════════

def quality_ok(
    level: dict,
    paths: list[list[tuple[int, int]]],
    target_colors: int,
    min_md: int,
    min_path_len: int,
) -> bool:
    dots = level["dots"]
    n = len(dots)

    if n != target_colors:
        return False

    for p in paths:
        if len(p) < min_path_len:
            return False
        if len(set(p)) != len(p):          # loop
            return False

    for d in dots:
        if manhattan(d["a"]["r"], d["a"]["c"], d["b"]["r"], d["b"]["c"]) < min_md:
            return False

    total = sum(len(p) for p in paths)
    if max(len(p) for p in paths) > total * 0.45:
        return False

    return True


# ═══════════════════════════════════════════════════════════════
# Uniqueness solver
# ═══════════════════════════════════════════════════════════════

def verify_puzzle(level: dict, time_limit: float = 8.0,
                  check_unique: bool = False) -> str:
    """Check the puzzle validity.

    When *check_unique* is False (default — fast mode):
        Only checks no short solution exists.  Returns "ok" or "short".

    When *check_unique* is True (strict mode):
        Also verifies exactly 1 full-board solution.

    Returns
    -------
    "ok"      — valid (no short solutions; unique if checked)
    "short"   — a solution exists that doesn't fill the board
    "multi"   — more than one full-board solution (strict only)
    "none"    — no solution at all (strict only)
    "timeout" — search exceeded *time_limit*
    """
    w = level["width"]
    h = level["height"]
    dots = level["dots"]
    n = len(dots)
    total = w * h

    grid = [[-1] * w for _ in range(h)]
    for d in dots:
        grid[d["a"]["r"]][d["a"]["c"]] = d["colorId"]
        grid[d["b"]["r"]][d["b"]["c"]] = d["colorId"]

    heads = list((d["a"]["r"], d["a"]["c"]) for d in dots)
    targets = [(d["b"]["r"], d["b"]["c"]) for d in dots]
    done = [False] * n
    filled = n * 2  # endpoints pre-placed

    # process most-constrained flows first (shortest Manhattan distance)
    order = sorted(
        range(n),
        key=lambda i: manhattan(
            dots[i]["a"]["r"], dots[i]["a"]["c"],
            dots[i]["b"]["r"], dots[i]["b"]["c"],
        ),
    )

    full_count = 0
    has_short = False
    t0 = time.time()
    timed_out = False
    nodes = 0
    # In unique mode, stop after 2 full solutions (proves non-unique).
    # In no-short mode, don't stop at full solutions — keep searching for
    # short solutions until the search space is exhausted or we time out.
    max_full = 2 if check_unique else 10_000_000

    def dfs(oi: int) -> None:
        nonlocal filled, full_count, has_short, timed_out, nodes
        if full_count >= max_full or has_short or timed_out:
            return

        nodes += 1
        if nodes & 0xFFFF == 0 and time.time() - t0 > time_limit:
            timed_out = True
            return

        # advance to next incomplete flow
        while oi < n and done[order[oi]]:
            oi += 1
        if oi >= n:
            if filled == total:
                full_count += 1
            else:
                has_short = True
            return

        ci = order[oi]
        hr, hc = heads[ci]
        tr, tc = targets[ci]

        for dr, dc in DIRS:
            if full_count >= max_full or has_short or timed_out:
                return
            nr, nc = hr + dr, hc + dc
            if not (0 <= nr < h and 0 <= nc < w):
                continue

            # reached target
            if nr == tr and nc == tc:
                done[ci] = True
                old = heads[ci]
                heads[ci] = (nr, nc)
                dfs(oi)
                heads[ci] = old
                done[ci] = False
                continue

            if grid[nr][nc] != -1:
                continue

            # --- place cell & prune ---
            grid[nr][nc] = ci
            old = heads[ci]
            heads[ci] = (nr, nc)
            filled += 1

            prune = False
            # dead-cell check: did we isolate an empty neighbour?
            for dr2, dc2 in DIRS:
                cr, cc = nr + dr2, nc + dc2
                if not (0 <= cr < h and 0 <= cc < w) or grid[cr][cc] != -1:
                    continue
                empty_adj = sum(
                    1 for dr3, dc3 in DIRS
                    if 0 <= cr + dr3 < h and 0 <= cc + dc3 < w
                    and grid[cr + dr3][cc + dc3] == -1
                )
                if empty_adj == 0:
                    # (cr,cc) has no empty exits.  It can only be filled
                    # by a flow whose head is adjacent, and that flow must
                    # be able to exit (cr,cc) — either (cr,cc) IS the
                    # target or the target is a neighbour of (cr,cc).
                    reachable = False
                    for k in range(n):
                        if done[k]:
                            continue
                        kh = heads[k]
                        if manhattan(kh[0], kh[1], cr, cc) != 1:
                            continue
                        kt = targets[k]
                        if (cr, cc) == (kt[0], kt[1]):
                            reachable = True
                            break
                        if manhattan(cr, cc, kt[0], kt[1]) == 1:
                            reachable = True
                            break
                    if not reachable:
                        prune = True
                        break

            if not prune:
                dfs(oi)

            filled -= 1
            heads[ci] = old
            grid[nr][nc] = -1

    dfs(0)

    if timed_out:
        return "timeout"
    if has_short:
        return "short"
    if check_unique:
        if full_count == 0:
            return "none"
        if full_count >= 2:
            return "multi"
    return "ok"


# ═══════════════════════════════════════════════════════════════
# Level builder
# ═══════════════════════════════════════════════════════════════

def build_level(
    paths: list[list[tuple[int, int]]], w: int, h: int,
) -> dict:
    dots = [
        {
            "colorId": ci,
            "a": {"r": p[0][0], "c": p[0][1]},
            "b": {"r": p[-1][0], "c": p[-1][1]},
        }
        for ci, p in enumerate(paths)
    ]
    return {"width": w, "height": h, "dots": dots}


# ═══════════════════════════════════════════════════════════════
# Main generation loop
# ═══════════════════════════════════════════════════════════════

def generate_level(
    w: int,
    h: int,
    num_colors: int,
    *,
    min_md: int = 2,
    min_path_len: int = 3,
    max_attempts: int = 5000,
    solver_limit: float = 3.0,
    strict_unique: bool = False,
) -> dict | None:
    total = w * h
    stats = {"grow_ok": 0, "ham_ok": 0, "quality_fail": 0,
             "verify_short": 0, "verify_multi": 0, "verify_timeout": 0,
             "verify_none": 0}

    for attempt in range(max_attempts):
        # ── Strategy A: round-robin growth (70 % of attempts) ──
        if attempt % 10 < 7:
            result = fill_grid_grow(w, h, num_colors)
            if result is None:
                continue
            paths = result

            # merge paths shorter than min_path_len
            paths = merge_short(paths, w, h, min_path_len)

            # if still too many, merge again with a higher threshold
            if len(paths) > num_colors + 1:
                paths = merge_short(paths, w, h, min_len=max(min_path_len, 5))

            # if too few, split longest paths
            if len(paths) < num_colors:
                paths = split_longest(paths, w, h, num_colors,
                                      min_path_len, min_md)
            stats["grow_ok"] += 1

        # ── Strategy B: Hamiltonian path splitting (30 %) ──
        else:
            hp = rand_hamilton(w, h)
            if hp is None:
                continue
            segments = split_hamilton(hp, num_colors, min_path_len, min_md)
            if segments is None:
                continue
            paths = segments
            stats["ham_ok"] += 1

        # ── verify grid is fully covered ──
        covered = sum(len(p) for p in paths)
        if covered != total:
            continue

        # ── build & quality check ──
        level = build_level(paths, w, h)
        if not quality_ok(level, paths, num_colors, min_md, min_path_len):
            stats["quality_fail"] += 1
            continue

        # ── verification ──
        verdict = verify_puzzle(level, solver_limit, check_unique=strict_unique)
        if verdict == "ok":
            return level
        if verdict == "timeout":
            # timeout is unreliable — a short solution may still exist.
            # Reject and retry to guarantee puzzle quality.
            stats["verify_timeout"] += 1
            continue
        stats[f"verify_{verdict}"] += 1

    print(f"  [stats] {stats}", end=" ")
    return None


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main() -> None:
    configs = [
        # (w, h, colors, min_manhattan, solver_time, strict_unique, label)
        (5, 5, 5, 2,  3.0, True,  "Easy"),
        (5, 5, 5, 2,  3.0, True,  "Easy"),
        (5, 5, 6, 2,  3.0, True,  "Easy-Med"),
        (6, 6, 6, 2,  5.0, True,  "Medium"),
        (6, 6, 7, 2,  5.0, True,  "Medium"),
        (6, 6, 7, 2,  5.0, True,  "Med-Hard"),
        (7, 7, 7, 2, 10.0, False, "Hard"),
        (7, 7, 8, 2, 10.0, False, "Hard"),
        (8, 8, 8, 2, 15.0, False, "V.Hard"),
        (8, 8, 9, 2, 15.0, False, "Expert"),
    ]

    out_dir = Path(__file__).resolve().parent.parent / "public" / "levels"
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    for i, (w, h, colors, min_md, slimit, strict, label) in enumerate(configs):
        level_num = i + 1
        tag = "unique" if strict else "no-short"
        print(f"Level {level_num:>2} ({w}x{h}, {colors}c, md>={min_md}, {tag}, {label}): ",
              end="", flush=True)

        t0 = time.time()
        level = generate_level(
            w, h, colors,
            min_md=min_md,
            min_path_len=3,
            max_attempts=10000,
            solver_limit=slimit,
            strict_unique=strict,
        )
        elapsed = time.time() - t0

        if not level:
            print(f"FAILED ({elapsed:.1f}s)")
            continue

        dots = level["dots"]
        mds = [manhattan(d["a"]["r"], d["a"]["c"], d["b"]["r"], d["b"]["c"])
               for d in dots]

        fp = out_dir / f"level{level_num}.json"
        fp.write_text(json.dumps(level, indent=2), encoding="utf-8")
        print(f"OK [{elapsed:.1f}s] md={min(mds)}-{max(mds)}")
        ok += 1

    print(f"\n{ok}/{len(configs)} levels generated")


if __name__ == "__main__":
    main()
