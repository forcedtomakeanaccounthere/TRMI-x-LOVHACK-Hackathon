import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.schemas import RecapData
from app.services import providers

TOKEN = "test-internal-token"

RECAP = RecapData(
    one_line_summary="s",
    key_points=["k"],
    what_the_group_cared_about=[],
    disagreements=[],
    open_questions=[],
    next_steps=[],
)


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    """Known settings for every test, ignoring the developer's real .env and API keys."""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    env = {
        "ENVIRONMENT": "test",
        "AI_INTERNAL_TOKEN": TOKEN,
        "AI_PROVIDERS": "nvidia,gemini",
        "NVIDIA_API_KEY": "nv-key",
        "NVIDIA_MODEL": "nv-a,nv-b",
        "GEMINI_API_KEY": "gm-key",
        "GEMINI_MODEL": "gm-a",
        "MISTRAL_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    providers._failures.clear()
    yield
    get_settings.cache_clear()
    providers._failures.clear()


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


@pytest.fixture
def auth():
    return {"X-Internal-Token": TOKEN}


class Clock:
    """time.monotonic that only moves when a fake provider call takes time."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr("time.monotonic", fake)
    return fake


class FakeAI:
    """Stands in for the providers. `fail` holds the models that raise, `cost` how many seconds a
    model's call takes on the fake clock; every call is recorded with the timeout it was given."""

    def __init__(self, clock: Clock):
        self.clock = clock
        self.fail: set[str] = set()
        self.cost: dict[str, float] = {}
        self.calls: list[tuple[str, float]] = []
        self.answer = RECAP  # what a working model returns
        self.system = self.user = ""  # the last prompt sent

    async def __call__(self, provider, system, user, schema, timeout):
        self.calls.append((provider.model, timeout))
        self.system, self.user = system, user
        self.clock.now += self.cost.get(provider.model, 0.0)
        if provider.model in self.fail:
            raise RuntimeError(f"{provider.model} is down")
        return self.answer

    @property
    def models(self):
        return [model for model, _ in self.calls]


@pytest.fixture
def fake_ai(monkeypatch, clock):
    fake = FakeAI(clock)
    monkeypatch.setattr("app.services.recap.complete_json", fake)
    return fake
