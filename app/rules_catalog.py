"""The built-in rules as the console shows them (GET /v1/rules/builtin).

`id` is the key the console stores toggles under, `labels` are the detector labels the entry stands for. One label can
back several entries (every secret is the label "시크릿"), so a label is only switched off when all of its entries are.
tests/test_company_policy.py checks that every detector label has an entry, so the list cannot drift from the code.
"""
from dataclasses import dataclass

from . import detector


@dataclass(frozen=True)
class Entry:
    id: str
    group: str  # basic | secret
    name: str
    desc: str
    example: str
    labels: tuple[str, ...]


GROUPS = {
    "basic": ("기본 정보 (개인정보)", "어느 회사나 지켜야 하는 정보예요"),
    "secret": ("보안 정보", "밖으로 나가면 바로 사고가 나는 정보예요"),
}

ENTRIES: tuple[Entry, ...] = (
    Entry("b:사람", "basic", "이름", '직함이 붙은 이름 · "고객 홍길동", "김부장님"', "고객 홍길동", ("사람",)),
    Entry("b:전화번호", "basic", "전화번호", "휴대폰 번호", "010-0000-0000", ("전화번호",)),
    Entry("b:이메일", "basic", "이메일", "회사 · 개인 메일 주소", "name@example.com", ("이메일",)),
    Entry("b:주민번호", "basic", "주민등록번호", "앞 6자리 + 뒤 7자리", "000000-1000000", ("주민번호",)),
    Entry("b:외국인등록번호", "basic", "외국인등록번호", "뒤 7자리가 5~8로 시작", "900101-5000000", ("외국인등록번호",)),
    Entry("b:법인등록번호", "basic", "법인등록번호", '"법인번호" 같은 말 뒤의 번호', "법인번호 000000-0000000", ("법인등록번호",)),
    Entry("b:사업자번호", "basic", "사업자번호", "000-00-00000 모양", "000-00-00000", ("사업자번호",)),
    Entry("b:여권번호", "basic", "여권 번호", '"여권" 같은 말 근처의 번호', "여권 M00000000", ("여권번호",)),
    Entry("b:운전면허번호", "basic", "운전면허 번호", '"면허" 같은 말 근처의 번호', "면허 00-00-000000-00", ("운전면허번호",)),
    Entry("b:차량번호", "basic", "차량번호", "번호판 모양", "00가 0000", ("차량번호",)),
    Entry("s:ip", "secret", "IP 주소", "서버 · 장비 주소 · 0.0.0.0 모양 (버전 번호와 127.0.0.1은 제외)", "10.1.2.3", ("IP주소",)),
    Entry("s:apikey", "secret", "API 키", "gitleaks 기본 규칙 · sk-, AKIA 등으로 시작하는 키", "sk-EXAMPLE••••", ("시크릿",)),
    Entry("s:password", "secret", "비밀번호", '"비밀번호:", "password=" 뒤의 값', "password=••••••", ("시크릿",)),
    Entry("s:dburl", "secret", "서버 · DB 접속 주소", "아이디·비밀번호가 들어간 주소", "db://user:••••@host", ("시크릿",)),
    Entry("s:privkey", "secret", "개인 키 파일 내용", "-----BEGIN PRIVATE KEY-----", "-----BEGIN …", ("시크릿",)),
)

BY_ID = {e.id: e for e in ENTRIES}
NAME_TO_LABELS = {e.name: e.labels for e in ENTRIES}


def default_action(labels: tuple[str, ...]) -> str:
    """What the detector does with these labels when no company rule says otherwise."""
    if "시크릿" in labels:
        return "block"
    return next((a for lab, _rx, a, *_ in detector.BUILTIN_RULES if lab in labels), "redact")


def catalog() -> list[dict]:
    return [
        {
            "id": gid,
            "name": name,
            "desc": desc,
            "rules": [
                {"id": e.id, "name": e.name, "desc": e.desc, "example": e.example, "labels": list(e.labels), "action": default_action(e.labels)}
                for e in ENTRIES
                if e.group == gid
            ],
        }
        for gid, (name, desc) in GROUPS.items()
    ]


def covered_labels() -> set[str]:
    return {lab for e in ENTRIES for lab in e.labels}
