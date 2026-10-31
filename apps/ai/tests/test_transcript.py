import asyncio
import time
from dataclasses import dataclass, field

import pytest
from youtube_transcript_api._errors import (
    AgeRestricted,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)

from app.config import get_settings
from app.services.transcript import (
    NoTranscript,
    TranscriptError,
    _client,
    _TimeoutSession,
    fetch_transcript,
)

VIDEO = "dQw4w9WgXcQ"


@dataclass
class Snippet:
    text: str
    start: float
    duration: float


@dataclass
class Fetched:
    snippets: list[Snippet]
    language_code: str = "en"
    is_generated: bool = False

    def __iter__(self):
        return iter(self.snippets)


@dataclass
class Listed:
    """A transcript from list(): fetch() returns its captions."""

    language_code: str
    is_generated: bool
    snippets: list[Snippet] = field(default_factory=lambda: [Snippet("Hola", 0, 1)])

    def fetch(self):
        return Fetched(self.snippets, self.language_code, self.is_generated)


class FakeYouTube:
    """Stands in for YouTubeTranscriptApi. Set `fetched`, `error` or `listed`; calls recorded."""

    instances: list["FakeYouTube"] = []
    fetched = Fetched(
        [
            Snippet("Hello and welcome", 0.0, 2.5),
            Snippet("  ", 2.5, 1),
            Snippet("to the talk", 3.5, 2),
        ]
    )
    error: Exception | None = None
    listed: list[Listed] = []
    delay = 0.0

    def __init__(self, proxy_config=None, http_client=None):
        self.proxy_config = proxy_config
        self.http_client = http_client
        self.calls: list[tuple] = []
        FakeYouTube.instances.append(self)

    def fetch(self, video_id, languages=("en",)):
        self.calls.append(("fetch", video_id, list(languages)))
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        return self.fetched

    def list(self, video_id):
        self.calls.append(("list", video_id))
        return self.listed


@pytest.fixture
def youtube(monkeypatch):
    FakeYouTube.instances = []
    FakeYouTube.error = None
    FakeYouTube.listed = []
    FakeYouTube.delay = 0.0
    monkeypatch.setattr("app.services.transcript.YouTubeTranscriptApi", FakeYouTube)
    # Default yt-dlp fallback to also report no captions in unit tests unless explicitly mocked
    def _fail_ytdlp(*a, **k):
        raise NoTranscript("This video has no captions")
    monkeypatch.setattr("app.services.transcript._fetch_with_ytdlp", _fail_ytdlp)
    return FakeYouTube


def post(client, auth, **body):
    return client.post("/transcript", json={"video_id": VIDEO, **body}, headers=auth)


def test_needs_the_internal_token(client, youtube):
    assert client.post("/transcript", json={"video_id": VIDEO}).status_code == 401


def test_returns_the_segments_with_text_in_the_preferred_languages(client, auth, youtube):
    res = post(client, auth)
    assert res.status_code == 200
    assert res.json() == {
        "language": "en",
        "is_generated": False,
        "segments": [
            {"start": 0.0, "duration": 2.5, "text": "Hello and welcome"},
            {"start": 3.5, "duration": 2.0, "text": "to the talk"},
        ],
    }
    assert youtube.instances[0].calls == [("fetch", VIDEO, ["en", "hi"])]


def test_falls_back_to_any_language_preferring_manual_captions(client, auth, youtube):
    youtube.error = NoTranscriptFound(VIDEO, ["en", "hi"], None)
    youtube.listed = [Listed("es", True), Listed("fr", False, [Snippet("Bonjour", 1, 2)])]
    body = post(client, auth).json()
    assert body["language"] == "fr"
    assert body["segments"] == [{"start": 1.0, "duration": 2.0, "text": "Bonjour"}]


@pytest.mark.parametrize(
    "error, status",
    [
        (TranscriptsDisabled(VIDEO), 404),
        (VideoUnavailable(VIDEO), 404),
        (AgeRestricted(VIDEO), 404),
        (RequestBlocked(VIDEO), 403),
        (IpBlocked(VIDEO), 403),
        (RuntimeError("network"), 502),
    ],
)
def test_maps_failures_to_statuses(client, auth, youtube, error, status):
    youtube.error = error
    assert post(client, auth).status_code == status


def test_no_transcript_in_any_language_is_a_404(client, auth, youtube):
    youtube.error = NoTranscriptFound(VIDEO, ["en"], None)
    youtube.listed = []
    assert post(client, auth).status_code == 404


def test_captions_with_no_text_are_a_404(client, auth, youtube, monkeypatch):
    monkeypatch.setattr(youtube, "fetched", Fetched([Snippet(" ", 0, 1)]))
    assert post(client, auth).status_code == 404


def test_gives_up_after_the_deadline(youtube, monkeypatch):
    # Called directly, inside one event loop: TestClient makes a loop per request and closing it
    # waits for the abandoned thread, which a long-running server never does.
    monkeypatch.setenv("TRANSCRIPT_TIMEOUT_SECONDS", "0.2")
    get_settings.cache_clear()
    youtube.delay = 1.0

    async def timed():
        started = time.perf_counter()
        with pytest.raises(TranscriptError, match="timed out"):
            await fetch_transcript(VIDEO, ["en"])
        return time.perf_counter() - started

    assert asyncio.run(timed()) < 0.6


def test_every_youtube_request_has_a_timeout(youtube, monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_TIMEOUT_SECONDS", "7")
    get_settings.cache_clear()
    assert isinstance(_client().http_client, _TimeoutSession)  # the fake keeps what it was given
    sent = {}
    monkeypatch.setattr("requests.Session.request", lambda self, *a, **kw: sent.update(kw))
    _TimeoutSession(7).request("GET", "https://www.youtube.com/watch?v=x")
    assert sent["timeout"] == 7


def test_uses_the_proxy_when_set(client, auth, youtube, monkeypatch):
    monkeypatch.setenv("YT_PROXY_URL", "http://user:pass@proxy.test:8080")
    get_settings.cache_clear()
    post(client, auth)
    config = youtube.instances[0].proxy_config
    assert (
        config is not None
        and config.to_requests_dict()["https"] == "http://user:pass@proxy.test:8080"
    )


@pytest.mark.parametrize("video_id", ["short", "x" * 12, "bad id/ok12", ""])
def test_refuses_an_invalid_video_id(client, auth, youtube, video_id):
    assert client.post("/transcript", json={"video_id": video_id}, headers=auth).status_code == 422
    assert youtube.instances == []


def test_ytdlp_fallback_when_transcript_api_disabled(client, auth, youtube, monkeypatch):
    youtube.error = TranscriptsDisabled(VIDEO)
    from app.schemas import TranscriptResponse, TranscriptSegment
    monkeypatch.setattr(
        "app.services.transcript._fetch_with_ytdlp",
        lambda vid, langs: TranscriptResponse(
            language="en",
            is_generated=True,
            segments=[TranscriptSegment(start=1.2, duration=3.4, text="Recovered by yt-dlp")],
        ),
    )
    res = post(client, auth)
    assert res.status_code == 200
    assert res.json()["segments"][0]["text"] == "Recovered by yt-dlp"

