"""Ways people really write things that the first set of built-in rules missed (found by trying realistic sentences)."""
import pytest
from fastapi.testclient import TestClient

from app import detector, main
from app.sanitizer import find_matches


def found(text: str) -> list[tuple[str, str]]:
    return [(text[m.start : m.end], m.label) for m in find_matches(text, [])]


@pytest.mark.parametrize(
    "text,value",
    [
        ("010 1234 5678로 연락주세요", "010 1234 5678"),
        ("연락처 010.1234.5678", "010.1234.5678"),
        ("전화 +82-10-1234-5678", "+82-10-1234-5678"),
        ("전화 +82 10 1234 5678", "+82 10 1234 5678"),
        ("대표번호 02-1234-5678", "02-1234-5678"),
        ("지점 031-123-4567", "031-123-4567"),
        ("인터넷전화 070-1234-5678", "070-1234-5678"),
    ],
)
def test_phone_numbers_in_other_notations(text, value):
    assert (value, "전화번호") in found(text)


@pytest.mark.parametrize(
    "text",
    [
        "주문번호 20240315-0001234 배송 문의",
        "2024 1234 5678 합계",  # not a phone prefix
        "버전 1.2.3 배포는 10월 27일",
        "계좌 0123456789 확인",  # a bare run of digits is never taken for a landline
        "11:30 회의, 02월 12일 3-4교시",
    ],
)
def test_ordinary_numbers_are_not_phone_numbers(text):
    assert not [m for m in found(text) if m[1] == "전화번호"]


@pytest.mark.parametrize("text", ["홍길동 고객님께 안내드립니다", "김철수 회원님 혜택 안내", "박영희 환자분 진료 예약"])
def test_a_name_followed_by_an_honorific_is_found(text):
    assert [label for _, label in found(text)] == ["사람"]


@pytest.mark.parametrize(
    "text,value",
    [
        ("비밀번호는 Abc12345! 입니다", "Abc12345!"),
        ("비번은 abc12345 로 바꿔줘", "abc12345"),
        ("패스워드가 hunter22 인데", "hunter22"),
    ],
)
def test_a_password_said_in_a_sentence_is_blocked(text, value):
    hits = find_matches(text, [])
    assert [(text[m.start : m.end], m.action) for m in hits] == [(value, "block")]


@pytest.mark.parametrize(
    "text",
    [
        "비밀번호는 정기적으로 변경해야 합니다",
        "비밀번호는 8자 이상이어야 합니다",
        "비밀번호는 required 입니다",  # a word, not a password: it needs a digit or a symbol
        "password policy requires 12 characters",
    ],
)
def test_talking_about_passwords_is_not_a_password(text):
    assert not find_matches(text, [])


# ---- IP addresses are found without a keyword such as "IP" or "서버"
def _ips(text):
    return [text[m.start:m.end] for m in detector.builtin_matches(text) if m.label == "IP주소"]


def test_ip_addresses_are_found_with_no_keyword_around():
    assert _ips("10.1.2.3") == ["10.1.2.3"]
    assert _ips("192.168.0.1 로 붙어줘") == ["192.168.0.1"]
    assert _ips("203.0.113.45") == ["203.0.113.45"]
    assert _ips("a 8.8.8.8, b 1.1.1.1.") == ["8.8.8.8", "1.1.1.1"]
    assert _ips("(172.16.0.5)") == ["172.16.0.5"]


def test_ip_lookalikes_are_left_alone():
    for text in ["127.0.0.1", "0.0.0.0", "255.255.255.255", "버전 10.0.19045.1", "v1.2.3.4", "version 2.3.4.5", "Ver.1.2.3.4",
                 "1.2.3", "256.1.1.1", "1.2.3.4.5", "2024.10.30.1", "12345.1.2.3", "가격 1,234.5"]:
        assert _ips(text) == [], text


def test_the_ip_rule_is_in_the_catalog_and_masks_in_a_message():
    from app import rules_catalog

    assert "IP주소" in rules_catalog.covered_labels()
    r = TestClient(main.app).post("/v1/sanitize", json={"text": "접속은 10.1.2.3 으로"}).json()
    assert "10.1.2.3" not in r["text"] and r["findings"] == {"IP주소": 1}
