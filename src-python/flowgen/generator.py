"""Main generation loop — orchestrates grid filling, quality checks, and solving."""

from __future__ import annotations

import logging

from .grid import Coord, Level
from .grower import fill_grid_grow
from .hamiltonian import rand_hamilton, split_hamilton
from .pathops import merge_short, split_longest
from .quality import build_level, quality_ok
from .solver import verify_puzzle

log = logging.getLogger(__name__)


def generate_level(
    w: int,
    h: int,
    num_colors: int,
    *,
    min_md: int = 2,
    min_path_len: int = 3,
    max_attempts: int = 10_000,
    solver_limit: float = 3.0,
    strict_unique: bool = False,
) -> Level | None:
    """Generate a valid Numberlink puzzle.

    Alternates between two grid-filling strategies:
    - Strategy A (70%): Multi-seed round-robin growth
    - Strategy B (30%): Hamiltonian path splitting

    Returns None if no valid puzzle found within max_attempts.
    """
    total = w * h
    stats = {
        "grow_ok": 0,
        "ham_ok": 0,
        "quality_fail": 0,
        "verify_short": 0,
        "verify_multi": 0,
        "verify_timeout": 0,
        "verify_none": 0,
    }

    for attempt in range(max_attempts):
        # Strategy A: round-robin growth (70% of attempts)
        if attempt % 10 < 7:
            result = fill_grid_grow(w, h, num_colors)
            if result is None:
                continue
            paths: list[list[Coord]] = result

            paths = merge_short(paths, w, h, min_path_len)
            if len(paths) > num_colors + 1:
                paths = merge_short(paths, w, h, min_len=max(min_path_len, 5))
            if len(paths) < num_colors:
                paths = split_longest(paths, w, h, num_colors, min_path_len, min_md)

            stats["grow_ok"] += 1

        # Strategy B: Hamiltonian path splitting (30%)
        else:
            hp = rand_hamilton(w, h)
            if hp is None:
                continue
            segments = split_hamilton(hp, num_colors, min_path_len, min_md)
            if segments is None:
                continue
            paths = segments
            stats["ham_ok"] += 1

        # Verify grid is fully covered
        covered = sum(len(p) for p in paths)
        if covered != total:
            continue

        # Build & quality check
        level = build_level(paths, w, h)
        if not quality_ok(level, paths, num_colors, min_md, min_path_len):
            stats["quality_fail"] += 1
            continue

        # Verification — reject timeouts (short solution might exist)
        verdict = verify_puzzle(level, solver_limit, check_unique=strict_unique)
        if verdict == "ok":
            return level
        stats[f"verify_{verdict}"] += 1

    log.info("Generation stats: %s", stats)
    return None
