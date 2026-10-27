"""Policy engine: turn detected matches into a request-level decision.

`internal_only` needs internal-model routing, which is out of scope this week,
so it is treated as `block` (fail closed) rather than silently sent out.
"""
from .detector import Match


def should_block(matches: list[Match]) -> bool:
    return any(m.action in ("block", "internal_only") for m in matches)
