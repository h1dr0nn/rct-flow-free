"""Strategy B — Hamiltonian path generation with smart splitting.

Generates a Hamiltonian path using Warnsdorff's heuristic with
randomised tie-breaking, then splits it at random cut-points that
satisfy Manhattan distance constraints.
"""

from __future__ import annotations

import random

from .grid import DIRS, Coord, manhattan_rc


def rand_hamilton(w: int, h: int) -> list[Coord] | None:
    """Warnsdorff's heuristic with randomised tie-breaking."""
    visited = [[False] * w for _ in range(h)]
    path: list[Coord] = []
    total = w * h

    def degree(r: int, c: int) -> int:
        return sum(
            1
            for dr, dc in DIRS
            if 0 <= r + dr < h and 0 <= c + dc < w and not visited[r + dr][c + dc]
        )

    def dfs(r: int, c: int) -> bool:
        visited[r][c] = True
        path.append(Coord(r, c))
        if len(path) == total:
            return True
        nbrs = sorted(
            (
                (degree(r + dr, c + dc), random.random(), r + dr, c + dc)
                for dr, dc in DIRS
                if 0 <= r + dr < h and 0 <= c + dc < w and not visited[r + dr][c + dc]
            ),
        )
        for _, _, nr, nc in nbrs:
            if dfs(nr, nc):
                return True
        visited[r][c] = False
        path.pop()
        return False

    # Prefer interior starts to reduce edge-clustering
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
    hp: list[Coord],
    num_colors: int,
    min_len: int,
    min_md: int,
    max_attempts: int = 500,
) -> list[list[Coord]] | None:
    """Split a Hamiltonian path at random cut-points satisfying constraints."""
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

        segments: list[list[Coord]] = []
        prev = 0
        bad = False
        for c in cuts + [total]:
            seg = hp[prev:c]
            md = manhattan_rc(seg[0].r, seg[0].c, seg[-1].r, seg[-1].c)
            if md < min_md:
                bad = True
                break
            segments.append(seg)
            prev = c
        if bad:
            continue

        # Reject if one segment dominates
        if max(len(s) for s in segments) > total * 0.45:
            continue

        return segments

    return None
