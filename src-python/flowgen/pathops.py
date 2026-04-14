"""Path adjustment operations — merge short paths, split long paths."""

from __future__ import annotations

import random

from .grid import DIRS, Coord, make_grid, manhattan_rc


def merge_short(
    paths: list[list[Coord] | None],
    w: int,
    h: int,
    min_len: int,
) -> list[list[Coord]]:
    """Merge paths shorter than *min_len* into a neighbour via endpoint adjacency."""
    clean: list[list[Coord]] = [p for p in paths if p is not None]
    grid = make_grid(clean, w, h)
    paths_mut: list[list[Coord] | None] = list(clean)

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
                    new_path: list[Coord] | None = None
                    if (nr, nc) == (q[0].r, q[0].c):
                        new_path = (
                            list(reversed(p)) if a_ei == 0 else list(p)
                        ) + list(q)
                    elif (nr, nc) == (q[-1].r, q[-1].c):
                        new_path = list(q) + (
                            list(p) if a_ei == 0 else list(reversed(p))
                        )
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

    return [p for p in paths_mut if p is not None]


def split_longest(
    paths: list[list[Coord]],
    w: int,
    h: int,
    target: int,
    min_len: int,
    min_md: int,
) -> list[list[Coord]]:
    """Split the longest path to approach *target* path count."""
    while len(paths) < target:
        candidates = [
            (i, len(p)) for i, p in enumerate(paths) if len(p) >= 2 * min_len
        ]
        if not candidates:
            break
        candidates.sort(key=lambda x: -x[1])

        did_split = False
        for idx, _ in candidates:
            p = paths[idx]
            for _ in range(80):
                k = random.randint(min_len, len(p) - min_len)
                a, b = p[:k], p[k:]
                if (
                    manhattan_rc(a[0].r, a[0].c, a[-1].r, a[-1].c) >= min_md
                    and manhattan_rc(b[0].r, b[0].c, b[-1].r, b[-1].c) >= min_md
                ):
                    paths[idx] = a
                    paths.append(b)
                    did_split = True
                    break
            if did_split:
                break
        if not did_split:
            break
    return paths
