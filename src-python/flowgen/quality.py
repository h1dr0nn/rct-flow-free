"""Quality filter and level builder."""

from __future__ import annotations

from .grid import Coord, Dot, Level, manhattan_rc


def build_level(
    paths: list[list[Coord]],
    w: int,
    h: int,
) -> Level:
    """Build a Level from solved paths."""
    dots = tuple(
        Dot(
            color_id=ci,
            a=Coord(p[0].r, p[0].c),
            b=Coord(p[-1].r, p[-1].c),
        )
        for ci, p in enumerate(paths)
    )
    return Level(width=w, height=h, dots=dots)


def quality_ok(
    level: Level,
    paths: list[list[Coord]],
    target_colors: int,
    min_md: int,
    min_path_len: int,
) -> bool:
    """Return True if the puzzle meets quality criteria."""
    dots = level.dots

    if len(dots) != target_colors:
        return False

    for p in paths:
        if len(p) < min_path_len:
            return False
        if len(set(p)) != len(p):  # loop detection
            return False

    for d in dots:
        if manhattan_rc(d.a.r, d.a.c, d.b.r, d.b.c) < min_md:
            return False

    total = sum(len(p) for p in paths)
    if max(len(p) for p in paths) > total * 0.45:
        return False

    return True
