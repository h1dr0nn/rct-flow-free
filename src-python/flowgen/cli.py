"""CLI entry point for level generation."""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

from .generator import generate_level
from .grid import level_to_dict, manhattan_rc

log = logging.getLogger(__name__)

# Level configs: (w, h, colors, min_manhattan, solver_time, strict_unique, label)
DEFAULT_CONFIGS = [
    # (w, h, colors, min_manhattan, solver_time, strict_unique, label)
    # All levels use strict_unique=True to guarantee exactly 1 solution.
    # Larger grids use more colors so paths stay short → solver stays fast.
    (5, 5,  5, 2,  3.0, True, "Easy"),
    (5, 5,  5, 2,  3.0, True, "Easy"),
    (5, 5,  6, 2,  3.0, True, "Easy-Med"),
    (6, 6,  6, 2,  5.0, True, "Medium"),
    (6, 6,  7, 2,  5.0, True, "Medium"),
    (6, 6,  7, 2,  5.0, True, "Med-Hard"),
    (7, 7, 10, 2, 15.0, True, "Hard"),
    (7, 7, 11, 2, 15.0, True, "Hard"),
    (8, 8, 13, 2, 45.0, True, "V.Hard"),
    (8, 8, 14, 2, 45.0, True, "Expert"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Flow Free levels")
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Output directory (default: public/levels/)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
    )

    out_dir = args.output or (
        Path(__file__).resolve().parent.parent.parent / "public" / "levels"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    for i, (w, h, colors, min_md, slimit, strict, label) in enumerate(DEFAULT_CONFIGS):
        level_num = i + 1
        tag = "unique" if strict else "no-short"
        print(
            f"Level {level_num:>2} ({w}x{h}, {colors}c, md>={min_md}, {tag}, {label}): ",
            end="",
            flush=True,
        )

        t0 = time.time()
        level = generate_level(
            w,
            h,
            colors,
            min_md=min_md,
            min_path_len=3,
            max_attempts=10_000,
            solver_limit=slimit,
            strict_unique=strict,
        )
        elapsed = time.time() - t0

        if not level:
            print(f"FAILED ({elapsed:.1f}s)")
            continue

        mds = [manhattan_rc(d.a.r, d.a.c, d.b.r, d.b.c) for d in level.dots]

        fp = out_dir / f"level{level_num}.json"
        fp.write_text(json.dumps(level_to_dict(level), indent=2), encoding="utf-8")
        print(f"OK [{elapsed:.1f}s] md={min(mds)}-{max(mds)}")
        ok += 1

    print(f"\n{ok}/{len(DEFAULT_CONFIGS)} levels generated")


if __name__ == "__main__":
    main()
