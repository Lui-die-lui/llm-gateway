"""Token vault: placeholder <-> original value mapping, scoped to one request.

The mapping lives only in memory for the lifetime of a single request.
It must never be logged or sent upstream.
"""
import re

PLACEHOLDER_RE = re.compile(r"\[[^\[\]\s]+_\d+\]")


class Vault:
    def __init__(self) -> None:
        self._by_value: dict[tuple[str, str], str] = {}
        self._by_placeholder: dict[str, str] = {}
        self._counters: dict[str, int] = {}
        self._numeric: set[str] = set()  # placeholders whose original was a JSON number

    def placeholder(self, label: str, value: str, numeric: bool = False) -> str:
        """Return the placeholder for value; same value gets the same placeholder."""
        key = (label, value)
        if key not in self._by_value:
            n = self._counters.get(label, 0) + 1
            self._counters[label] = n
            ph = f"[{label}_{n}]"
            self._by_value[key] = ph
            self._by_placeholder[ph] = value
        if numeric:
            self._numeric.add(self._by_value[key])
        return self._by_value[key]

    def restore(self, text: str) -> str:
        """Swap known placeholders back to originals; unknown ones are left as-is."""
        return PLACEHOLDER_RE.sub(lambda m: self._by_placeholder.get(m.group(0), m.group(0)), text)

    def restore_value(self, text: str):
        """restore(), for a string value inside JSON arguments: exactly one placeholder of a number goes back as a number,
        so a tool that takes {"salary": 5000000} does not get "5000000"."""
        if text in self._numeric:
            raw = self._by_placeholder[text]
            for cast in (int, float):
                try:
                    return cast(raw)
                except ValueError:
                    continue
        return self.restore(text)
