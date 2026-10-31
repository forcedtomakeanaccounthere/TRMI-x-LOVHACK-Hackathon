"""Fetches a YouTube video's captions (POST /transcript) with youtube-transcript-api.

The library is synchronous, so a fetch runs in a thread under a deadline. The preferred languages
are tried first, then any transcript the video has. YouTube often blocks cloud hosts: set
YT_PROXY_URL to fetch through a proxy, and apps/backend offers "paste the transcript" when it fails.
"""

import asyncio
import logging

import requests
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    AgeRestricted,
    InvalidVideoId,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
)
from youtube_transcript_api.proxies import GenericProxyConfig

from app.config import get_settings
from app.schemas import MAX_TRANSCRIPT_SEGMENTS, TranscriptResponse, TranscriptSegment

log = logging.getLogger(__name__)


class TranscriptError(Exception):
    pass


class NoTranscript(TranscriptError):
    """The video has no captions, or can't be played (private, removed, age-restricted)."""


class TranscriptBlocked(TranscriptError):
    """YouTube refused this server's request: the transcript exists, but not from here."""


class _TimeoutSession(requests.Session):
    """A session whose every request has a timeout. The library sets none, and a fetch that
    outlives its deadline keeps running in its thread: this way that thread ends too."""

    def __init__(self, timeout: float):
        super().__init__()
        self.timeout = timeout

    def request(self, *args, **kwargs):
        kwargs.setdefault("timeout", self.timeout)
        return super().request(*args, **kwargs)


def _client() -> YouTubeTranscriptApi:
    settings = get_settings()
    session = _TimeoutSession(settings.transcript_timeout_seconds)
    proxy = settings.yt_proxy_url
    config = GenericProxyConfig(http_url=proxy, https_url=proxy) if proxy else None
    return YouTubeTranscriptApi(proxy_config=config, http_client=session)


def _fetch(video_id: str, languages: list[str]) -> TranscriptResponse:
    api = _client()
    try:
        fetched = api.fetch(video_id, languages=languages)
    except NoTranscriptFound:
        # None in the preferred languages: take whatever the video has, manual captions first.
        available = sorted(api.list(video_id), key=lambda t: t.is_generated)
        if not available:
            raise
        fetched = available[0].fetch()

    segments = [
        TranscriptSegment(start=s.start, duration=s.duration, text=s.text)
        for s in list(fetched)[:MAX_TRANSCRIPT_SEGMENTS]
        if s.text.strip()
    ]
    if not segments:
        raise NoTranscript("The video's captions are empty")
    return TranscriptResponse(
        language=fetched.language_code, is_generated=fetched.is_generated, segments=segments
    )


async def fetch_transcript(video_id: str, languages: list[str]) -> TranscriptResponse:
    timeout = get_settings().transcript_timeout_seconds
    try:
        return await asyncio.wait_for(asyncio.to_thread(_fetch, video_id, languages), timeout)
    except (TranscriptsDisabled, NoTranscriptFound) as e:
        raise NoTranscript("This video has no captions") from e
    except (VideoUnavailable, VideoUnplayable, InvalidVideoId, AgeRestricted) as e:
        raise NoTranscript("This video can't be played, so its captions can't be read") from e
    except (RequestBlocked, IpBlocked) as e:
        log.warning("YouTube blocked a transcript request (set YT_PROXY_URL): %s", type(e).__name__)
        raise TranscriptBlocked("YouTube blocked the request from this server") from e
    except TranscriptError:
        raise
    except TimeoutError as e:
        raise TranscriptError("Fetching the transcript timed out") from e
    except Exception as e:
        log.warning("Transcript fetch failed: %r", e)
        raise TranscriptError("Fetching the transcript failed") from e
