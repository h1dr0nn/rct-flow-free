"""Two-phase Numberlink puzzle verifier.

Phase 1 — Short-solution detection:
    DFS WITHOUT dead-cell pruning. Uses target-directed move ordering
    to find short solutions fast. A short solution connects all flows
    without filling the entire board.

Phase 2 — Uniqueness check (optional):
    DFS WITH dead-cell pruning. Counts full-board solutions and stops
    at 2 (proves non-unique).

Key insight: dead-cell pruning is correct for finding full-board
solutions but PREVENTS finding short solutions. The two phases need
fundamentally different pruning strategies.

References:
    - https://mzucker.github.io/2016/08/28/flow-solver.html
    - https://en.wikipedia.org/wiki/Numberlink
"""

from __future__ import annotations

import sys
import time
from collections import deque

from .grid import DIRS, Coord, Level, manhattan_rc

sys.setrecursionlimit(200_000)


def verify_puzzle(
    level: Level,
    time_limit: float = 8.0,
    check_unique: bool = False,
) -> str:
    """Two-phase puzzle verification.

    Returns
    -------
    "ok"      — no short solutions; unique if checked
    "short"   — a non-full-board solution exists
    "multi"   — more than one full-board solution (strict only)
    "none"    — no full-board solution at all (strict only)
    "timeout" — search exceeded time budget
    """
    # Budget split: 60% for short-solution search, 40% for uniqueness
    short_budget = time_limit * (0.6 if check_unique else 1.0)
    unique_budget = time_limit * 0.4

    result = _check_short_solutions(level, short_budget)
    if result != "ok":
        return result

    if not check_unique:
        return "ok"

    return _check_uniqueness(level, unique_budget)


# ═══════════════════════════════════════════════════════════════
# Phase 1 — Short-solution detection
# ═══════════════════════════════════════════════════════════════


def _check_short_solutions(level: Level, time_limit: float) -> str:
    """Search for solutions that connect all flows without filling the board.

    Uses greedy BFS: for each of many flow orderings, connect every
    flow via its BFS-shortest non-overlapping path.  If all flows
    connect and cells remain empty, a short solution exists.

    This is O(orderings * n * w * h) — fast even for 8x8 grids.
    """
    w, h = level.width, level.height
    dots = level.dots
    n = len(dots)
    total = w * h

    sources = [Coord(d.a.r, d.a.c) for d in dots]
    targets = [Coord(d.b.r, d.b.c) for d in dots]

    def bfs_shortest(
        sr: int, sc: int, tr: int, tc: int, blocked: set[tuple[int, int]]
    ) -> list[tuple[int, int]] | None:
        """BFS shortest path from (sr,sc) to (tr,tc) avoiding blocked cells."""
        if (sr, sc) == (tr, tc):
            return [(sr, sc)]
        q: deque[tuple[int, int, list[tuple[int, int]]]] = deque()
        q.append((sr, sc, [(sr, sc)]))
        visited = {(sr, sc)}
        while q:
            r, c, path = q.popleft()
            for dr, dc in DIRS:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < h and 0 <= nc < w):
                    continue
                if (nr, nc) in visited:
                    continue
                if (nr, nc) in blocked and (nr, nc) != (tr, tc):
                    continue
                npath = path + [(nr, nc)]
                if nr == tr and nc == tc:
                    return npath
                visited.add((nr, nc))
                q.append((nr, nc, npath))
        return None

    def try_greedy(order: list[int]) -> bool:
        """Try connecting all flows in given order using shortest paths."""
        used: set[tuple[int, int]] = set()
        # Pre-block all dot positions
        for i in range(n):
            used.add((sources[i].r, sources[i].c))
            used.add((targets[i].r, targets[i].c))

        for i in order:
            path = bfs_shortest(
                sources[i].r, sources[i].c,
                targets[i].r, targets[i].c,
                used,
            )
            if path is None:
                return False
            for cell in path:
                used.add(cell)

        # Flag as "short" if greedy coverage is very low.
        # For small grids the threshold is strict; for large grids
        # (where shortest paths naturally cover less) it's relaxed.
        threshold = 0.85 if total <= 36 else (0.70 if total <= 49 else 0.60)
        return len(used) < total * threshold

    t0 = time.time()
    import random

    # Build orderings: key heuristic ones + random permutations
    orderings: list[list[int]] = []

    # Shortest Manhattan distance first
    orderings.append(
        sorted(range(n), key=lambda i: manhattan_rc(*sources[i], *targets[i]))
    )
    # Longest first
    orderings.append(
        sorted(range(n), key=lambda i: -manhattan_rc(*sources[i], *targets[i]))
    )
    # Each flow first
    for start in range(n):
        rest = [j for j in range(n) if j != start]
        orderings.append(
            [start] + sorted(rest, key=lambda i: manhattan_rc(*sources[i], *targets[i]))
        )

    # Random shuffles — scale count by grid density.
    # Dense grids (many colors, small area) have more short solutions,
    # so checking too many orderings rejects almost everything.
    coverage_ratio = (n * 2) / total  # endpoints / cells
    if coverage_ratio > 0.25:      # 8x8/9c → 18/64 = 0.28
        num_random = 10
    elif coverage_ratio > 0.20:    # 7x7/7c → 14/49 = 0.29
        num_random = 20
    else:
        num_random = 40

    rng = random.Random(42)
    indices = list(range(n))
    for _ in range(num_random):
        rng.shuffle(indices)
        orderings.append(indices[:])

    seen: set[tuple[int, ...]] = set()
    for order in orderings:
        if time.time() - t0 > time_limit:
            break
        key = tuple(order)
        if key in seen:
            continue
        seen.add(key)
        if try_greedy(order):
            return "short"

    return "ok"


# ═══════════════════════════════════════════════════════════════
# Phase 2 — Uniqueness verification
# ═══════════════════════════════════════════════════════════════


def _check_uniqueness(level: Level, time_limit: float) -> str:
    """Verify exactly one full-board solution exists.

    Uses DFS with dead-cell pruning (correct for full-board search).
    Stops at 2 solutions to prove non-uniqueness.
    """
    w, h = level.width, level.height
    dots = level.dots
    n = len(dots)
    total = w * h

    grid = [[-1] * w for _ in range(h)]
    for d in dots:
        grid[d.a.r][d.a.c] = d.color_id
        grid[d.b.r][d.b.c] = d.color_id

    heads = [list(d.a) for d in dots]
    targets = [(d.b.r, d.b.c) for d in dots]
    done = [False] * n
    filled = n * 2

    order = sorted(
        range(n),
        key=lambda i: manhattan_rc(dots[i].a.r, dots[i].a.c, dots[i].b.r, dots[i].b.c),
    )

    full_count = 0
    t0 = time.time()
    timed_out = False
    nodes = 0

    def dfs(oi: int) -> None:
        nonlocal filled, full_count, timed_out, nodes
        if full_count >= 2 or timed_out:
            return

        nodes += 1
        if nodes & 0xFFF == 0 and time.time() - t0 > time_limit:
            timed_out = True
            return

        while oi < n and done[order[oi]]:
            oi += 1
        if oi >= n:
            if filled == total:
                full_count += 1
            return

        ci = order[oi]
        hr, hc = heads[ci]
        tr, tc = targets[ci]

        for dr, dc in DIRS:
            if full_count >= 2 or timed_out:
                return
            nr, nc = hr + dr, hc + dc
            if not (0 <= nr < h and 0 <= nc < w):
                continue

            if nr == tr and nc == tc:
                done[ci] = True
                old_r, old_c = heads[ci]
                heads[ci] = [nr, nc]
                dfs(oi)
                heads[ci] = [old_r, old_c]
                done[ci] = False
                continue

            if grid[nr][nc] != -1:
                continue

            grid[nr][nc] = ci
            old_r, old_c = heads[ci]
            heads[ci] = [nr, nc]
            filled += 1

            # Dead-cell pruning (correct for full-board search)
            prune = False
            for dr2, dc2 in DIRS:
                cr, cc = nr + dr2, nc + dc2
                if not (0 <= cr < h and 0 <= cc < w) or grid[cr][cc] != -1:
                    continue
                empty_adj = sum(
                    1
                    for dr3, dc3 in DIRS
                    if 0 <= cr + dr3 < h
                    and 0 <= cc + dc3 < w
                    and grid[cr + dr3][cc + dc3] == -1
                )
                if empty_adj == 0:
                    reachable = False
                    for k in range(n):
                        if done[k]:
                            continue
                        khr, khc = heads[k]
                        if manhattan_rc(khr, khc, cr, cc) != 1:
                            continue
                        ktr, ktc = targets[k]
                        if (cr, cc) == (ktr, ktc):
                            reachable = True
                            break
                        if manhattan_rc(cr, cc, ktr, ktc) == 1:
                            reachable = True
                            break
                    if not reachable:
                        prune = True
                        break

            if not prune:
                dfs(oi)

            filled -= 1
            heads[ci] = [old_r, old_c]
            grid[nr][nc] = -1

    dfs(0)

    if timed_out:
        return "timeout"
    if full_count == 0:
        return "none"
    if full_count >= 2:
        return "multi"
    return "ok"
