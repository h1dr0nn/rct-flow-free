"""Strategy A — Multi-seed round-robin growth.

Seeds are scattered across the grid. All paths grow simultaneously
in round-robin, creating naturally interleaving color flows.
Warnsdorff heuristic is used per-step to avoid creating isolated cells.
"""

from __future__ import annotations

import random

from .grid import DIRS, Coord, manhattan_rc


def fill_grid_grow(
    w: int,
    h: int,
    num_seeds: int,
) -> list[list[Coord]] | None:
    """Fill grid by growing *num_seeds* paths from scattered seeds.

    Returns list of paths or None if the grid couldn't be fully filled.
    """
    grid = [[-1] * w for _ in range(h)]
    unfilled: set[tuple[int, int]] = {(r, c) for r in range(h) for c in range(w)}

    # Place seeds with spacing >= 2 Manhattan distance
    all_cells = list(unfilled)
    random.shuffle(all_cells)
    seeds: list[tuple[int, int]] = []
    for r, c in all_cells:
        if len(seeds) >= num_seeds:
            break
        if any(manhattan_rc(r, c, sr, sc) < 2 for sr, sc in seeds):
            continue
        seeds.append((r, c))
    # Relax spacing if not enough seeds found
    for r, c in all_cells:
        if len(seeds) >= num_seeds:
            break
        if (r, c) not in seeds:
            seeds.append((r, c))

    paths: list[list[Coord]] = []
    for i, (r, c) in enumerate(seeds):
        paths.append([Coord(r, c)])
        grid[r][c] = i
        unfilled.discard((r, c))

    # Round-robin growth
    active = list(range(num_seeds))

    while unfilled and active:
        next_active: list[int] = []
        random.shuffle(active)

        for i in active:
            if not unfilled:
                break
            p = paths[i]
            extended = False
            # Try both endpoints in random order
            endpoints = [len(p) - 1, 0]
            if random.random() < 0.5:
                endpoints.reverse()

            for ei in endpoints:
                r, c = p[ei]
                nbrs = [
                    (r + dr, c + dc)
                    for dr, dc in DIRS
                    if (r + dr, c + dc) in unfilled
                ]
                if not nbrs:
                    continue
                # Warnsdorff: prefer neighbor with fewest remaining exits
                best = min(
                    nbrs,
                    key=lambda rc: (
                        sum(
                            1
                            for dr, dc in DIRS
                            if (rc[0] + dr, rc[1] + dc) in unfilled
                            and (rc[0] + dr, rc[1] + dc) != (r, c)
                        ),
                        random.random(),
                    ),
                )
                nr, nc = best
                if ei == len(p) - 1:
                    p.append(Coord(nr, nc))
                else:
                    p.insert(0, Coord(nr, nc))
                grid[nr][nc] = i
                unfilled.discard((nr, nc))
                extended = True
                break

            if extended:
                next_active.append(i)

        # Rescue: if growth stalled but cells remain
        if not next_active and unfilled:
            rescued = False
            for i in range(len(paths)):
                for ei in (len(paths[i]) - 1, 0):
                    r, c = paths[i][ei]
                    nbrs = [
                        (r + dr, c + dc)
                        for dr, dc in DIRS
                        if (r + dr, c + dc) in unfilled
                    ]
                    if nbrs:
                        nr, nc = random.choice(nbrs)
                        if ei == len(paths[i]) - 1:
                            paths[i].append(Coord(nr, nc))
                        else:
                            paths[i].insert(0, Coord(nr, nc))
                        grid[nr][nc] = i
                        unfilled.discard((nr, nc))
                        next_active.append(i)
                        rescued = True
                        break
                if rescued:
                    break
            if not rescued:
                return None

        active = next_active

    return None if unfilled else paths
