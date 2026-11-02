"""Validate industry templates: schema, regex syntax, and the template's own `tests` examples.

Run: python -m app.check_templates [directory]      (exit code 1 if anything fails)
"""
import re
import sys
from pathlib import Path

from .detector import detect, taxonomy_matches
from .evaluate import covered
from .taxonomy import Industry, load_industry


def check_industry(ind: Industry) -> list[str]:
    problems = []
    for e in ind.entities:
        for p in e.detection.patterns:
            try:
                re.compile(p)
            except re.error as err:
                problems.append(f"{e.id}: bad regex {p!r}: {err}")
        if not e.detection.patterns:
            problems.append(f"{e.id}: no patterns, so it can never be detected")
        if not e.detection.patterns and e.detection.context_keywords:
            problems.append(f"{e.id}: context_keywords only work together with patterns")
    if problems:
        return problems  # example results are meaningless with broken patterns
    for case in ind.tests:
        if case.detect:
            matches = detect(case.text, [ind])
            problems += [f"not masked: {v!r} in {case.text!r}" for v in case.detect if not covered(case.text, v, matches)]
        else:
            hits = [case.text[m.start : m.end] for m in taxonomy_matches(case.text, [ind])]
            if hits:
                problems.append(f"false positive {hits} in {case.text!r}")
    if not ind.tests:
        problems.append("no tests: add examples so the template can be verified")
    return problems


def main(directory: Path) -> int:
    failed = False
    for path in sorted(directory.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        try:
            problems = check_industry(load_industry(path))
        except ValueError as err:
            problems = [str(err)]
        print(f"{'FAIL' if problems else 'OK  '} {path.name}")
        for p in problems:
            print(f"     - {p}")
        failed |= bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "industries"))
