"""Detection-rate comparison: built-in (generic) rules vs. built-in + industry template.

Uses each template's `tests` examples as ground truth. Deterministic: the local LLM detector is not involved.
Run: python -m app.evaluate
"""
from pathlib import Path

from .detector import Match, detect, taxonomy_matches
from .taxonomy import Industry, load_industries


def covered(text: str, value: str, matches: list[Match]) -> bool:
    i = text.find(value)
    return i >= 0 and any(m.start <= i and i + len(value) <= m.end for m in matches)


def entity_examples(ind: Industry) -> dict[str, dict]:
    """What each template entity really catches, taken from the template's own `tests`: one example sentence and the values
    it masked. For the console to show next to a rule (entities defined only by a regex have no keyword list to show)."""
    out: dict[str, dict] = {}
    for entity in ind.entities:
        only = ind.model_copy(update={"entities": [entity]})
        example, detected = None, []
        for case in ind.tests:
            ms = taxonomy_matches(case.text, [only]) if case.detect else []
            values = [v for v in case.detect if covered(case.text, v, ms)]
            if values and example is None:
                example = {"text": case.text, "detect": values}
            detected += [v for v in values if v not in detected]
        out[entity.id] = {"example": example, "detected": detected}
    return out


def evaluate(industries: dict[str, Industry]) -> dict:
    rows = []
    for ind in industries.values():
        expected = generic = template = negatives = false_positives = 0
        for case in ind.tests:
            if case.detect:
                g, t = detect(case.text, []), detect(case.text, [ind])
                for v in case.detect:
                    expected += 1
                    generic += covered(case.text, v, g)
                    template += covered(case.text, v, t)
            else:
                negatives += 1
                false_positives += bool(taxonomy_matches(case.text, [ind]))
        rows.append(
            {
                "industry": ind.industry,
                "expected": expected,
                "generic_caught": generic,
                "template_caught": template,
                "generic_recall": round(generic / expected, 3) if expected else None,
                "template_recall": round(template / expected, 3) if expected else None,
                "negative_cases": negatives,
                "template_false_positives": false_positives,
            }
        )
    total = sum(r["expected"] for r in rows)
    return {
        "industries": rows,
        "overall": {
            "expected": total,
            "generic_recall": round(sum(r["generic_caught"] for r in rows) / total, 3) if total else None,
            "template_recall": round(sum(r["template_caught"] for r in rows) / total, 3) if total else None,
        },
    }


def to_markdown(result: dict) -> str:
    lines = ["| 산업 | 정답 값 | 범용 탐지 | 템플릿 탐지 | 오탐(음성 케이스) |", "|---|---|---|---|---|"]
    pct = lambda x: "-" if x is None else f"{x:.0%}"
    for r in result["industries"]:
        lines.append(
            f"| {r['industry']} | {r['expected']} | {pct(r['generic_recall'])} | {pct(r['template_recall'])}"
            f" | {r['template_false_positives']}/{r['negative_cases']} |"
        )
    o = result["overall"]
    lines.append(f"| **전체** | {o['expected']} | **{pct(o['generic_recall'])}** | **{pct(o['template_recall'])}** | |")
    return "\n".join(lines)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "industries"
    print(to_markdown(evaluate(load_industries(root))))
