"""Grid data types and utility functions for Numberlink puzzles."""

from __future__ import annotations

from typing import NamedTuple

# Cardinal directions: right, down, left, up
DIRS = [(0, 1), (1, 0), (0, -1), (-1, 0)]


class Coord(NamedTuple):
    r: int
    c: int


class Dot(NamedTuple):
    color_id: int
    a: Coord
    b: Coord


class Level(NamedTuple):
    width: int
    height: int
    dots: tuple[Dot, ...]


def manhattan(a: Coord, b: Coord) -> int:
    return abs(a.r - b.r) + abs(a.c - b.c)


def manhattan_rc(ar: int, ac: int, br: int, bc: int) -> int:
    return abs(ar - br) + abs(ac - bc)


def neighbors(r: int, c: int, w: int, h: int) -> list[Coord]:
    """Return in-bounds cardinal neighbors."""
    result: list[Coord] = []
    for dr, dc in DIRS:
        nr, nc = r + dr, c + dc
        if 0 <= nr < h and 0 <= nc < w:
            result.append(Coord(nr, nc))
    return result


def count_turns(path: list[Coord]) -> int:
    if len(path) < 3:
        return 0
    turns = 0
    for i in range(1, len(path) - 1):
        d1 = (path[i].r - path[i - 1].r, path[i].c - path[i - 1].c)
        d2 = (path[i + 1].r - path[i].r, path[i + 1].c - path[i].c)
        if d1 != d2:
            turns += 1
    return turns


def make_grid(paths: list[list[Coord]], w: int, h: int) -> list[list[int]]:
    """Build a 2D grid where each cell holds its path index, or -1."""
    grid = [[-1] * w for _ in range(h)]
    for i, p in enumerate(paths):
        for r, c in p:
            grid[r][c] = i
    return grid


# ── Serialization ──

def level_to_dict(level: Level) -> dict:
    return {
        "width": level.width,
        "height": level.height,
        "dots": [
            {
                "colorId": d.color_id,
                "a": {"r": d.a.r, "c": d.a.c},
                "b": {"r": d.b.r, "c": d.b.c},
            }
            for d in level.dots
        ],
    }


def level_from_dict(d: dict) -> Level:
    dots = tuple(
        Dot(
            color_id=dot["colorId"],
            a=Coord(dot["a"]["r"], dot["a"]["c"]),
            b=Coord(dot["b"]["r"], dot["b"]["c"]),
        )
        for dot in d["dots"]
    )
    return Level(width=d["width"], height=d["height"], dots=dots)
