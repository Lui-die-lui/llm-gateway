"""Secret detection: the gitleaks default rules (vendor/gitleaks.toml) plus two hand-written rules.

gitleaks rules are Go (RE2) regexes. They are loaded and converted to Python `re` once, when this module is first imported,
never per call. The conversion: re.ASCII (Go's \\b \\w \\d \\s are ASCII-only, so "AKIA...EXAMPLE입니다" still matches),
`\\z` and `$` -> `\\Z`, POSIX classes, and mid-pattern `(?i)` (Python only allows it at the very start). A rule that cannot be
converted, or whose rewritten `(?i)` form misses its sample token, is left out and listed in SKIPPED with the reason
(python -m app.secret_rules prints it).

Semantics follow gitleaks (detect.go): keywords prefilter, then the secret is secretGroup, else the first non-empty capture
group, else the whole match; entropy is measured on the secret and must be above the rule's value; global and per-rule
allowlists (regexes / stopwords) can still clear it.
"""
import math
import re
import tomllib
import warnings
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .detector import Match
from .taxonomy import Action

RULES_FILE = Path(__file__).resolve().parent.parent / "vendor" / "gitleaks.toml"
LABEL = "시크릿"
BLOCK_PRIORITY = 3  # above templates (2) and built-in PII (1): "postgres://u:pw@host" must stay a secret, not become an e-mail
REDACT_PRIORITY = 1
REDACT_ONLY = {"generic-api-key"}  # keyword-driven catch-all, too noisy on ordinary prose to block
# gitleaks allowlists the documented AWS example key (".+EXAMPLE$"). A pasted key is still stopped here.
IGNORED_ALLOW_REGEXES = {("aws-access-token", ".+EXAMPLE$")}


@dataclass(frozen=True)
class _Allow:
    target: str  # what the regexes are tested against: "secret" (default), "match" or "line"
    regexes: tuple[re.Pattern[str], ...]
    stopwords: tuple[str, ...]  # lowercase; allowed when the secret contains one
    all_of: bool  # gitleaks condition = AND


@dataclass(frozen=True)
class _Rule:
    id: str
    rx: re.Pattern[str]
    keywords: tuple[str, ...]  # lowercase; the regex only runs when one of them is in the text
    entropy: float  # 0 = no check
    secret_group: int  # 0 = first non-empty group, else the whole match
    action: Action
    priority: int
    allow: tuple[_Allow, ...]


# ---------------------------------------------------------------- Go (RE2) -> Python re

_POSIX = {
    "[:alnum:]": "A-Za-z0-9", "[:alpha:]": "A-Za-z", "[:digit:]": "0-9", "[:lower:]": "a-z",
    "[:upper:]": "A-Z", "[:xdigit:]": "A-Fa-f0-9", "[:space:]": r"\s",
}  # fmt: skip


def _skip_class(s: str, i: int) -> int:
    """s[i] is '[': index just past the closing ']' (a leading ']' is a literal)."""
    i += 1
    if s[i : i + 1] == "^":
        i += 1
    if s[i : i + 1] == "]":
        i += 1
    while i < len(s) and s[i] != "]":
        i += 2 if s[i] == "\\" else 1
    return i + 1


def _go_to_python(rx: str) -> str:
    """\\z and $ -> \\Z (Go's $ is end of text only, Python's also matches before a final newline); POSIX classes."""
    for k, v in _POSIX.items():
        rx = rx.replace(k, v)
    out, i = [], 0
    while i < len(rx):
        c = rx[i]
        if c == "\\":
            out.append("\\Z" if rx[i + 1 : i + 2] == "z" else rx[i : i + 2])
            i += 2
        elif c == "[":
            j = _skip_class(rx, i)
            out.append(rx[i:j])
            i = j
        else:
            out.append("\\Z" if c == "$" else c)
            i += 1
    return "".join(out)


def _group_end(s: str, i: int) -> int:
    """Index of the ')' that closes the group containing position i (len(s) at top level)."""
    depth = 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "[":
            i = _skip_class(s, i)
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            if depth == 0:
                return i
            depth -= 1
        i += 1
    return len(s)


def _alternatives(s: str) -> list[str]:
    parts, depth, last, i = [], 0, 0, 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "[":
            i = _skip_class(s, i)
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "|" and depth == 0:
            parts.append(s[last:i])
            last = i + 1
        i += 1
    parts.append(s[last:])
    return parts


def _mid_flag(s: str) -> int:
    """Index of the first '(?i)' that is not at the start of the pattern (-1 if none)."""
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "[":
            i = _skip_class(s, i)
            continue
        if i > 0 and s.startswith("(?i)", i):
            return i
        i += 1
    return -1


def _scope_inline_flags(s: str) -> str:
    """Go applies a mid-pattern (?i) to the rest of its group, alternatives included: rewrite as (?i:...) per alternative."""
    while (i := _mid_flag(s)) >= 0:
        end = _group_end(s, i + 4)
        s = s[:i] + "|".join(f"(?i:{a})" for a in _alternatives(s[i + 4 : end])) + s[end:]
    return s


def _compile(rx: str) -> tuple[re.Pattern[str], bool]:
    """-> (pattern, whether a mid-pattern (?i) had to be rewritten). Raises re.error / Warning if Python reads it differently."""
    fixed = _go_to_python(rx)
    scoped = _scope_inline_flags(fixed)
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # e.g. "possible nested set": the pattern would not mean what Go meant
        return re.compile(scoped, re.ASCII), scoped != fixed


# ---------------------------------------------------------------- matching

def _entropy(s: str) -> float:
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in Counter(s).values()) if n else 0.0


def _secret_span(m: re.Match[str], group: int) -> tuple[int, int] | None:
    if m.re.groups:
        if group:
            return m.span(group) if m.end(group) > m.start(group) else None
        for g in range(1, m.re.groups + 1):  # gitleaks: the first non-empty group, not necessarily group 1
            if m.end(g) > m.start(g):
                return m.span(g)
    return m.span()


def _allowed(allow: tuple[_Allow, ...], secret: str, text: str, m: re.Match[str]) -> bool:
    for a in allow:
        if a.target == "match":
            target = m.group(0)
        elif a.target == "line":
            line_end = text.find("\n", m.end())
            target = text[text.rfind("\n", 0, m.start()) + 1 : len(text) if line_end < 0 else line_end]
        else:
            target = secret
        by_regex = any(r.search(target) for r in a.regexes)
        by_word = any(w in secret.lower() for w in a.stopwords)
        if (a.all_of and (by_regex or not a.regexes) and (by_word or not a.stopwords)) or (not a.all_of and (by_regex or by_word)):
            return True
    return False


def _scan(rule: _Rule, text: str, low: str) -> list[Match]:
    if rule.keywords and not any(k in low for k in rule.keywords):
        return []
    found = []
    for m in rule.rx.finditer(text):
        span = _secret_span(m, rule.secret_group)
        if span is None:
            continue
        secret = text[span[0] : span[1]]
        if rule.entropy and _entropy(secret) <= rule.entropy:
            continue
        if _allowed(rule.allow, secret, text, m):
            continue
        found.append(Match(span[0], span[1], LABEL, rule.action, rule.priority))
    return found


# ---------------------------------------------------------------- load (once, at import)

def _fake(n: int, alphabet: str = "abcd1234efgh5678ijkl9012mnop3456qrst7890uvwx") -> str:
    """Obviously fake token body: the alphabet repeated. Never the plain a-z run, which gitleaks allowlists as a stopword."""
    return (alphabet * n)[:n]


_HEX, _FLW = "abcdef0123456789", "abcdefgh01234567"

# One sample per gitleaks rule whose mid-pattern (?i) is rewritten above. The rewrite is only trusted if the rule still finds
# its sample; otherwise the rule is skipped. Built from pieces so no token-shaped literal sits in the repo.
_SAMPLES = {
    "adobe-client-secret": 'key = "p8e-' + _fake(32) + '"',
    "alibaba-access-key-id": 'id = "LTAI' + _fake(20) + '"',
    "authress-service-client-access-key": "key = sc_" + _fake(12) + "." + _fake(5) + ".acc_" + _fake(12) + "." + _fake(40) + " end",
    "curl-auth-header": 'curl https://api.fake.test/v1 -H "Authorization: Bearer ' + _fake(24) + '"',
    "doppler-api-token": "DOPPLER_TOKEN=dp.pt." + _fake(43),
    "duffel-api-token": "duffel_test_" + _fake(43),
    "dynatrace-api-token": "dt0c01." + _fake(24) + "." + _fake(64),
    "easypost-api-token": "token EZAK" + _fake(54),
    "easypost-test-api-token": "token EZTK" + _fake(54),
    "facebook-page-access-token": 't = "EAAM' + _fake(100) + '"',
    "flutterwave-encryption-key": "FLWSECK_TEST-" + _fake(12, _FLW),
    "flutterwave-public-key": "FLWPUBK_TEST-" + _fake(32, _FLW) + "-X",
    "flutterwave-secret-key": "FLWSECK_TEST-" + _fake(32, _FLW) + "-X",
    "frameio-api-token": "fio-u-" + _fake(64),
    "gocardless-api-token": 'gocardless_token = "live_' + _fake(40) + '"',
    "intra42-client-secret": 'secret = "s-s4t2ud-' + _fake(64, _HEX) + '"',
    "linear-api-key": "lin_api_" + _fake(40),
    "planetscale-api-token": 't = "pscale_tkn_' + _fake(40) + '"',
    "planetscale-password": 'p = "pscale_pw_' + _fake(40) + '"',
    "postman-api-token": 'k = "PMAK-' + _fake(24, _HEX) + "-" + _fake(34, _HEX) + '"',
    "sendgrid-api-token": 'k = "SG.' + _fake(66) + '"',
    "sendinblue-api-token": 'k = "xkeysib-' + _fake(64, _HEX) + "-" + _fake(16) + '"',
}  # fmt: skip


def _allow(d: dict, rule_id: str, skipped: dict[str, str]) -> _Allow | None:
    """A gitleaks allowlist, or None if nothing in it can apply to plain text (paths / commits have no meaning here)."""
    all_of = str(d.get("condition", "OR")).upper() == "AND"
    if all_of and (d.get("paths") or d.get("commits")):
        return None  # AND needs a file path or commit to match too
    regexes = []
    for src in d.get("regexes", ()):
        if (rule_id, src) in IGNORED_ALLOW_REGEXES:
            continue
        try:
            regexes.append(_compile(src)[0])
        except (re.error, Warning) as e:  # a lost allowlist regex only makes the rule stricter
            skipped[f"{rule_id} (allowlist regex {src[:30]!r})"] = f"does not compile in Python re: {e}"
    stopwords = tuple(w.lower() for w in d.get("stopwords", ()))
    if not regexes and not stopwords:
        return None
    return _Allow(d.get("regexTarget", "secret"), tuple(regexes), stopwords, all_of)


def _load() -> tuple[tuple[_Rule, ...], dict[str, str]]:
    cfg = tomllib.loads(RULES_FILE.read_text(encoding="utf-8"))
    skipped: dict[str, str] = {}
    global_allow = tuple(a for a in [_allow(cfg.get("allowlist", {}), "(global)", skipped)] if a)
    rules = []
    for r in cfg["rules"]:
        rid = r["id"]
        if "regex" not in r:
            skipped[rid] = "no regex (path-only rule)"
            continue
        try:
            rx, rewritten = _compile(r["regex"])
        except (re.error, Warning) as e:
            skipped[rid] = f"does not compile in Python re: {e}"
            continue
        redact = rid in REDACT_ONLY
        rule = _Rule(
            id=rid,
            rx=rx,
            keywords=tuple(k.lower() for k in r.get("keywords", ())),
            entropy=float(r.get("entropy", 0)),
            secret_group=int(r.get("secretGroup", 0)),
            action="redact" if redact else "block",
            priority=REDACT_PRIORITY if redact else BLOCK_PRIORITY,
            allow=global_allow + tuple(a for a in (_allow(x, rid, skipped) for x in r.get("allowlists", ())) if a),
        )
        if rewritten:
            sample = _SAMPLES.get(rid)
            if sample is None:
                skipped[rid] = "inline (?i) rewritten, but there is no sample token to verify it"
                continue
            if not _scan(rule, sample, sample.lower()):
                skipped[rid] = "inline (?i) rewritten, but the rule did not detect its sample token (pattern, entropy or allowlist)"
                continue
        rules.append(rule)
    return tuple(rules), skipped


_RULES, SKIPPED = _load()


# ---------------------------------------------------------------- hand-written rules (not in gitleaks)

# Values that only stand in for a password.
_PLACEHOLDER = re.compile(
    r"\*+|x+|\.+|<[^>]*>|\$\{?\w+\}?|\{\{.*?\}\}|%\w+%|\[[^\]]*\]"
    r"|password|passwd|pass|pwd|secret|changeme|your[_-]?password|redacted|null|none|true|false|required|optional|string|empty|hidden|masked",
    re.I,
)
_PASSWORD_WORDS = ("비밀번호", "비번", "패스워드", "password", "passwd", "pw")
# "비밀번호: x", "password=x", '"pw": "x"'. Value = 4+ ASCII characters; Korean words ("비밀번호: 변경 주기") never match.
_PASSWORD = re.compile(
    r"""(?<![A-Za-z0-9])(?:비밀번호|비번|패스워드|password|passwd|pw)(?:은|는|이|가)?["'`]?[ \t]*[:=：][ \t]*["'`]?"""
    r"""((?:(?!["'`])[\x21-\x7e]){4,})""",
    re.I,
)
# The way people say it in Korean: "비밀번호는 Abc12345! 입니다" (no colon). Same value rules as above.
_PASSWORD_SPOKEN = re.compile(r"""(?<![A-Za-z0-9])(?:비밀번호|비번|패스워드)(?:은|는|이|가)[ 	]+((?:(?!["'`])[!-~]){4,})""")
_DB_URL = re.compile(
    r"\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver)://[^\s:/@]+:([^\s@/]+)@", re.I
)


def _hand_written(text: str, low: str) -> list[Match]:
    found = []
    if "://" in text:
        for m in _DB_URL.finditer(text):
            if not _PLACEHOLDER.fullmatch(m.group(1)):
                found.append(Match(m.start(1), m.end(1), LABEL, "block", BLOCK_PRIORITY))
    if any(w in low for w in _PASSWORD_WORDS):
        for m in (*_PASSWORD.finditer(text), *_PASSWORD_SPOKEN.finditer(text)):
            value = m.group(1).rstrip(".,;")  # sentence punctuation after the password is not part of it
            # Words and code ("Password: required", "password = get_password()") are not passwords: the value needs a digit
            # or one of !@#$%^&*+=~?, and must not be a placeholder.
            if len(value) >= 4 and not _PLACEHOLDER.fullmatch(value) and any(c.isdigit() or c in "!@#$%^&*+=~?" for c in value):
                found.append(Match(m.start(1), m.start(1) + len(value), LABEL, "block", BLOCK_PRIORITY))
    return found


def secret_matches(text: str) -> list[Match]:
    low = text.lower()
    found = _hand_written(text, low)
    for rule in _RULES:
        found += _scan(rule, text, low)
    return found


if __name__ == "__main__":
    print(f"gitleaks rules loaded: {len(_RULES)} ({sum(r.action == 'redact' for r in _RULES)} redact-only, rest block)")
    print(f"skipped: {len(SKIPPED)}")
    for k, v in SKIPPED.items():
        print(f"  {k}: {v}")
