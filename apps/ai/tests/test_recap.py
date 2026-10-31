import pytest

from app.services import providers
from app.services.providers import BREAKER_FAILURES

RECAP_REQUEST = {"title": "Paper", "text": "doc", "highlights": [], "comments": []}


def post(client, auth):
    return client.post("/recap", json=RECAP_REQUEST, headers=auth)


def test_first_provider_answers(client, auth, fake_ai):
    res = post(client, auth)
    assert res.status_code == 200
    assert res.json()["one_line_summary"] == "s"
    assert fake_ai.models == ["nv-a"]


def test_falls_back_through_models_then_providers(client, auth, fake_ai):
    fake_ai.fail = {"nv-a", "nv-b"}
    assert post(client, auth).status_code == 200
    assert fake_ai.models == ["nv-a", "nv-b", "gm-a"]


def test_502_when_every_provider_fails(client, auth, fake_ai):
    fake_ai.fail = {"nv-a", "nv-b", "gm-a"}
    res = post(client, auth)
    assert res.status_code == 502
    assert "All AI providers failed" in res.json()["detail"]


def test_503_when_no_provider_has_a_key(client, auth, fake_ai, monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    providers.get_settings.cache_clear()
    assert post(client, auth).status_code == 503
    assert fake_ai.calls == []


def test_a_model_that_keeps_failing_is_skipped(client, auth, fake_ai):
    fake_ai.fail = {"nv-a"}
    for _ in range(BREAKER_FAILURES):
        post(client, auth)
    fake_ai.calls.clear()

    assert post(client, auth).status_code == 200
    assert fake_ai.models == ["nv-b"]


def test_every_breaker_open_still_tries_them_all(client, auth, fake_ai):
    fake_ai.fail = {"nv-a", "nv-b", "gm-a"}
    for _ in range(BREAKER_FAILURES):
        post(client, auth)
    fake_ai.fail = set()
    fake_ai.calls.clear()

    assert post(client, auth).status_code == 200
    assert fake_ai.models == ["nv-a"]


def test_a_success_resets_the_breaker(client, auth, fake_ai):
    fake_ai.fail = {"nv-a"}
    for _ in range(BREAKER_FAILURES - 1):
        post(client, auth)
    fake_ai.fail = set()
    post(client, auth)  # nv-a recovers
    fake_ai.fail = {"nv-a"}
    post(client, auth)  # one fresh failure, well under the limit
    fake_ai.calls.clear()
    fake_ai.fail = set()

    post(client, auth)
    assert fake_ai.models == ["nv-a"]


def test_each_attempt_gets_at_most_the_time_left(client, auth, fake_ai, monkeypatch):
    monkeypatch.setenv("AI_TIMEOUT_SECONDS", "30")
    monkeypatch.setenv("RECAP_DEADLINE_SECONDS", "40")
    providers.get_settings.cache_clear()
    fake_ai.fail = {"nv-a"}
    fake_ai.cost = {"nv-a": 25.0}

    assert post(client, auth).status_code == 200
    assert fake_ai.calls == [("nv-a", 30.0), ("nv-b", 15.0)]


def test_stops_when_the_deadline_has_passed(client, auth, fake_ai, monkeypatch):
    monkeypatch.setenv("RECAP_DEADLINE_SECONDS", "10")
    providers.get_settings.cache_clear()
    fake_ai.fail = {"nv-a"}
    fake_ai.cost = {"nv-a": 8.0}  # leaves 2 s, under MIN_ATTEMPT_SECONDS

    res = post(client, auth)
    assert res.status_code == 502
    assert "deadline reached" in res.json()["detail"]
    assert fake_ai.models == ["nv-a"]


def test_breaker_window_expires(client, auth, fake_ai):
    fake_ai.fail = {"nv-a"}
    for _ in range(BREAKER_FAILURES):
        post(client, auth)
    fake_ai.clock.now += providers.BREAKER_WINDOW_SECONDS + 1
    fake_ai.fail = set()
    fake_ai.calls.clear()

    post(client, auth)
    assert fake_ai.models == ["nv-a"]


@pytest.mark.parametrize("rid, logged", [("abc-123", "[abc-123]"), ("bad id\n", "[-]")])
def test_logs_carry_the_request_id(client, auth, fake_ai, caplog, rid, logged):
    caplog.set_level("INFO")
    client.post("/recap", json=RECAP_REQUEST, headers={**auth, "X-Request-Id": rid})
    lines = [r for r in caplog.records if "Recap generated" in r.getMessage()]
    assert lines and f"[{lines[0].request_id}]" == logged
