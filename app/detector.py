"""Detection engine: built-in PII rules + industry taxonomy rules.

Regex first. Anything regex cannot express (free-form names, supplier names) is covered by the
optional local-LLM detector (llm_detector.py), whose matches are passed in through `extra`.
"""
import re
from dataclasses import dataclass

from .taxonomy import Action, Industry

CONTEXT_WINDOW = 40  # chars on each side of a pattern hit searched for context_keywords

# Labels scanned in model responses. Names and taxonomy rules are left out on purpose:
# they would redact ordinary answers (example names, "5% 함량" advice).
RESPONSE_LABELS = {"시크릿", "이메일", "주민번호", "외국인등록번호", "전화번호", "사업자번호"}


@dataclass(frozen=True)
class Match:
    start: int
    end: int
    label: str
    action: Action
    priority: int  # higher wins when matches overlap


_SURNAMES = "김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공"
_PARTICLE = "에게|한테|께서|으로|에서|님|씨|의|은|는|이|가|을|를|과|와|도|께|로"
_TITLE_BEFORE = "고객|환자|담당자|담당|대표|성명|성함|이름|보호자|수신자|신청인|계약자|예금주|작성자|문의자"
_TITLE_AFTER = r"(?:님|씨|(?:대표|이사|부장|과장|팀장|사원|대리|교수|박사|원장|의사|선생)(?:님)?)"
# Common words that start with a surname character and would otherwise look like a name after a title.
_NOT_NAME = (
    "이메일|이름|이용|이번|이상|이후|이전|이미|이것|이런|고객|환자|정보|주소|전화|번호|오늘|오전|오후|한국|서울|부산|"
    "김치|조건|조회|강의|신규|문의|우리|하나|나이|주문|구매|배송|정상|전체|최근|성별|성명|성함|신청|주민|가입|계좌|"
    "내용|결과|상담|처방|진단|서비스|제품|회원|담당|대표|문서|자료|계약|전송|정리|분석|요약|번역|확인|발송|예약|지정|"
    "조성|공급|방문|연락|주의|구분|사용|요청|한도|전달|전문|전용|공통|지급|보험|해당|가능|불가|적용|추가|성분|배합|"
    "함량|원료"
)
_NAME = rf"[{_SURNAMES}][가-힣]{{2}}"

# Letters that appear on Korean licence plates (private, commercial, rental, delivery). Other letters ("대", "년", "시")
# are left out so "20대 2024년" or "12시 3456" is not read as a plate.
_PLATE = "가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주하허호배아바사자"

# (label, regex, action[, keywords]). A capture group, if present, is the sensitive part.
# With `keywords`, a hit counts only when one of them is within CONTEXT_WINDOW chars (same rule as industry templates).
# Rule order matters on a tie (same priority and length): the earlier rule wins, so 법인등록번호 sits before 주민번호.
BUILTIN_RULES: list[tuple[str, re.Pattern[str], Action] | tuple[str, re.Pattern[str], Action, tuple[str, ...]]] = [
    ("시크릿", re.compile(r"sk-[A-Za-z0-9_-]{20,}"), "block"),
    ("이메일", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "redact"),
    # Same shape as 주민번호; only the label right in front tells them apart. The keyword is part of the pattern (group 1 =
    # the number) instead of a `keywords` window, so a nearby 주민번호 in the same sentence is not relabeled.
    ("법인등록번호", re.compile(r"(?:법인등록번호|법인번호|등기번호)\s*(?:은|는|이|가|:|：)?\s*(\d{6}-\d{7})(?!\d)"), "redact"),
    ("주민번호", re.compile(r"(?<!\d)\d{6}-[1-4][\dxX*]{6}(?!\d)"), "redact"),
    # Foreigner registration number: second part starts with 5-8. Birth date is validated to cut false positives.
    ("외국인등록번호", re.compile(r"(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-[5-8][\dxX*]{6}(?!\d)"), "redact"),
    ("전화번호", re.compile(r"(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)"), "redact"),
    ("사업자번호", re.compile(r"(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)"), "redact"),
    # Passport: new (M123A4567) and old (M12345678) formats. Product codes look alike, so a keyword is required.
    (
        "여권번호",
        re.compile(r"(?<![A-Za-z0-9])(?:[A-Z]\d{3}[A-Z]\d{4}|[A-Z]\d{8})(?![A-Za-z0-9])"),
        "redact",
        ("여권", "passport", "Passport", "PASSPORT"),
    ),
    ("운전면허번호", re.compile(r"(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)"), "redact", ("면허", "운전")),
    # Licence plate. Without a space it is distinctive enough; with a space ("90도 2024년") it needs a keyword.
    ("차량번호", re.compile(rf"(?<!\d)\d{{2,3}}[{_PLATE}]\d{{4}}(?!\d)"), "redact"),
    ("차량번호", re.compile(rf"(?<!\d)\d{{2,3}}[{_PLATE}]\s\d{{4}}(?!\d)"), "redact", ("차량", "번호판")),
    # 사람: only with a title/label next to it ("고객 홍길동", "홍길동 부장님"); bare names need the LLM detector.
    ("사람", re.compile(rf"(?:{_TITLE_BEFORE})\s*[:：]?\s*(?!{_NOT_NAME})({_NAME})(?=(?:{_PARTICLE})?(?![가-힣]))"), "redact"),
    ("사람", re.compile(rf"(?<![가-힣])({_NAME})\s?{_TITLE_AFTER}"), "redact"),
]


def _span(m: re.Match[str]) -> tuple[int, int]:
    return (m.start(1), m.end(1)) if m.re.groups else (m.start(), m.end())


def _has_context(text: str, start: int, end: int, keywords: list[str]) -> bool:
    window = text[max(0, start - CONTEXT_WINDOW) : end + CONTEXT_WINDOW]
    return any(k in window for k in keywords)


def builtin_matches(text: str, only: set[str] | None = None) -> list[Match]:
    found = []
    for label, rx, action, *rest in BUILTIN_RULES:
        if only is not None and label not in only:
            continue
        keywords = list(rest[0]) if rest else []
        for m in rx.finditer(text):
            start, end = _span(m)
            if keywords and not _has_context(text, start, end, keywords):
                continue
            found.append(Match(start, end, label, action, priority=1))
    return found


def taxonomy_matches(text: str, industries: list[Industry]) -> list[Match]:
    found: list[Match] = []
    for industry in industries:
        for entity in industry.entities:
            keywords = entity.detection.context_keywords
            for pattern in entity.detection.patterns:
                for m in re.finditer(pattern, text):
                    start, end = _span(m)
                    if start == end:
                        continue
                    if keywords and not _has_context(text, start, end, keywords):
                        continue
                    found.append(Match(start, end, entity.label or entity.id, entity.action, priority=2))
    return found


def detect(
    text: str,
    industries: list[Industry],
    extra: list[Match] | tuple[Match, ...] = (),
    only: set[str] | None = None,
) -> list[Match]:
    """Non-overlapping matches sorted by position. On overlap, higher priority then longer wins.

    `only` restricts to built-in labels (used for response scanning); `extra` adds matches from other detectors.
    """
    candidates = builtin_matches(text, only)
    if only is None or "시크릿" in only:  # gitleaks-based rules; response scanning gets them through RESPONSE_LABELS
        candidates += secret_rules.secret_matches(text)
    if only is None:
        candidates += taxonomy_matches(text, industries) + list(extra)
    candidates.sort(key=lambda m: (-m.priority, -(m.end - m.start), m.start))
    chosen: list[Match] = []
    for c in candidates:
        if all(c.end <= k.start or c.start >= k.end for k in chosen):
            chosen.append(c)
    return sorted(chosen, key=lambda m: m.start)


# Imported last: secret_rules needs Match from this module. Loading it here compiles the gitleaks rules once, at startup.
from . import secret_rules  # noqa: E402
