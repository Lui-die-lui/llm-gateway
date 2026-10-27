"""Policy engine: turn detected matches into a routing decision.

route:
  external  mask and send to the external LLM
  internal  an `internal_only` value is present: send the original request to the internal model instead
  block     refuse the request (a `block` value, or `internal_only` with no internal model configured)
"""
from .detector import Match
from .taxonomy import Industry


def applicable(industries: list[Industry], use_case: str | None, flow: str | None) -> list[Industry]:
    """Apply a template only when the request's use case / flow fit its `applies_to` (unset = always)."""
    return [
        i
        for i in industries
        if (not use_case or not i.applies_to.use_cases or use_case in i.applies_to.use_cases)
        and (not flow or not i.applies_to.flow or flow == i.applies_to.flow)
    ]


def decide(matches: list[Match], internal_available: bool) -> str:
    if any(m.action == "block" for m in matches):
        return "block"
    if any(m.action == "internal_only" for m in matches):
        return "internal" if internal_available else "block"
    return "external"
