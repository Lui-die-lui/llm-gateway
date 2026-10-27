"""Industry taxonomy schema (blueprint section 05) and YAML loader."""
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

Action = Literal["redact", "block", "internal_only"]


class Detection(BaseModel):
    patterns: list[str] = Field(default_factory=list)
    context_keywords: list[str] = Field(default_factory=list)
    ner_hint: str | None = None  # reserved for the local-LLM detector (Day 4-5)


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


class Industry(BaseModel):
    industry: str
    entities: list[Entity]
    applies_to: AppliesTo = Field(default_factory=AppliesTo)


def load_industries(directory: Path) -> dict[str, Industry]:
    industries: dict[str, Industry] = {}
    for path in sorted(directory.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        industry = Industry.model_validate(data)
        industries[industry.industry] = industry
    return industries
