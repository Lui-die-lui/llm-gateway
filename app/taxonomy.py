"""Industry taxonomy schema (blueprint section 05) and YAML loader."""
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, ValidationError

Action = Literal["redact", "block", "internal_only", "log"]  # log: let it through, record it


class Detection(BaseModel):
    patterns: list[str] = Field(default_factory=list)
    context_keywords: list[str] = Field(default_factory=list)
    ner_hint: str | None = None  # unused (the local LLM assist is gone); still read so older template files load


class Entity(BaseModel):
    id: str
    label: str | None = None  # placeholder name, e.g. "조성비" -> [조성비_1]; defaults to id
    detection: Detection = Field(default_factory=Detection)
    sensitivity: Literal["critical", "high", "medium"]
    action: Action
    regulation: list[str] = Field(default_factory=list)


class AppliesTo(BaseModel):
    use_cases: list[str] = Field(default_factory=list)
    flow: str | None = None


class Example(BaseModel):
    """Self-test: `detect` lists values this template must mask in `text`; empty means it must mask nothing."""

    text: str
    detect: list[str] = Field(default_factory=list)


class Industry(BaseModel):
    industry: str
    entities: list[Entity]
    applies_to: AppliesTo = Field(default_factory=AppliesTo)
    tests: list[Example] = Field(default_factory=list)


def load_industry(path: Path) -> Industry:
    try:
        return Industry.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
    except (ValidationError, yaml.YAMLError) as e:
        raise ValueError(f"{path.name}: {e}") from e


def load_industries(directory: Path) -> dict[str, Industry]:
    industries: dict[str, Industry] = {}
    for path in sorted(directory.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        industry = load_industry(path)
        industries[industry.industry] = industry
    return industries
