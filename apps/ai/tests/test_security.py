import pytest

from app.config import Settings, get_settings

RECAP = {"title": "t", "text": "doc"}


def test_health_needs_no_token(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["providers"] == ["nvidia:nv-a", "nvidia:nv-b", "gemini:gm-a"]


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Token": "wrong"}, {"X-Internal-Token": ""}])
def test_recap_refuses_a_missing_or_wrong_token(client, headers):
    assert client.post("/recap", json=RECAP, headers=headers).status_code == 401


def test_recap_without_token_is_allowed_in_development(client, monkeypatch, fake_ai):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "")
    get_settings.cache_clear()
    assert client.post("/recap", json=RECAP).status_code == 200


def test_production_refuses_to_start_without_a_token(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "")
    with pytest.raises(ValueError, match="AI_INTERNAL_TOKEN is required"):
        Settings()


def test_production_starts_with_a_token(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert Settings().ai_internal_token == "test-internal-token"
