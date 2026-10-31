"""Fetches a YouTube video's captions (POST /transcript) with youtube-transcript-api.

The library is synchronous, so a fetch runs in a thread under a deadline. The preferred languages
are tried first, then any transcript the video has. YouTube often blocks cloud hosts: set
YT_PROXY_URL to fetch through a proxy, and apps/backend offers "paste the transcript" when it fails.
"""

import asyncio
import logging

import requests
import yt_dlp
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


def _fetch_with_ytdlp(video_id: str, languages: list[str]) -> TranscriptResponse:
    url = f"https://www.youtube.com/watch?v={video_id}"
    ydl_opts = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as e:
            raise NoTranscript(f"yt-dlp could not fetch video metadata: {e}") from e

        if not info:
            raise NoTranscript("Could not retrieve video info")

        subs = info.get("subtitles") or {}
        auto_subs = info.get("automatic_captions") or {}

        chosen_lang = None
        is_generated = False
        track_formats = None

        for lang in languages:
            if lang in subs:
                chosen_lang = lang
                track_formats = subs[lang]
                break
        if not track_formats and subs:
            chosen_lang = next(iter(subs))
            track_formats = subs[chosen_lang]

        if not track_formats:
            is_generated = True
            for lang in languages:
                if lang in auto_subs:
                    chosen_lang = lang
                    track_formats = auto_subs[lang]
                    break
            if not track_formats and auto_subs:
                chosen_lang = next(iter(auto_subs))
                track_formats = auto_subs[chosen_lang]

        if not track_formats:
            raise NoTranscript("This video has no captions")

        json3_url = next((f["url"] for f in track_formats if f.get("ext") == "json3"), None)
        vtt_url = next((f["url"] for f in track_formats if f.get("ext") == "vtt"), None)
        target_url = json3_url or vtt_url or track_formats[0].get("url")
        if not target_url:
            raise NoTranscript("No caption track URL available")

        resp = requests.get(target_url, timeout=10)
        resp.raise_for_status()

        segments = []
        if json3_url or "json" in target_url:
            data = resp.json()
            events = data.get("events") or []
            for ev in events:
                start_ms = ev.get("tStartMs", 0)
                dur_ms = ev.get("dDurationMs", 0)
                segs = ev.get("segs") or []
                text = "".join(s.get("utf8", "") for s in segs).strip()
                if text and text != "\n":
                    segments.append(
                        TranscriptSegment(
                            start=round(start_ms / 1000.0, 2),
                            duration=round(dur_ms / 1000.0, 2),
                            text=text,
                        )
                    )
        else:
            for line in resp.text.splitlines():
                line = line.strip()
                if (
                    line
                    and not line.startswith("WEBVTT")
                    and "-->" not in line
                    and not line.isdigit()
                ):
                    segments.append(TranscriptSegment(start=None, duration=None, text=line))

        segments = segments[:MAX_TRANSCRIPT_SEGMENTS]
        if not segments:
            raise NoTranscript("The video's captions are empty")

        return TranscriptResponse(
            language=chosen_lang,
            is_generated=is_generated,
            segments=segments,
        )


def _fetch(video_id: str, languages: list[str]) -> TranscriptResponse:
    api = _client()
    try:
        fetched = api.fetch(video_id, languages=languages)
    except NoTranscriptFound:
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
        # Fallback to yt-dlp to extract auto-generated or manual subtitles
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_fetch_with_ytdlp, video_id, languages), timeout
            )
        except Exception:
            raise NoTranscript("This video has no captions") from e
    except (VideoUnavailable, VideoUnplayable, InvalidVideoId, AgeRestricted) as e:
        raise NoTranscript("This video can't be played, so its captions can't be read") from e
    except (RequestBlocked, IpBlocked) as e:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_fetch_with_ytdlp, video_id, languages), timeout
            )
        except Exception:
            log.warning(
                "YouTube blocked a transcript request (set YT_PROXY_URL): %s", type(e).__name__
            )
            raise TranscriptBlocked("YouTube blocked the request from this server") from e
    except TranscriptError:
        raise
    except TimeoutError as e:
        raise TranscriptError("Fetching the transcript timed out") from e
    except Exception as e:
        log.warning("Transcript fetch failed: %r", e)
        raise TranscriptError("Fetching the transcript failed") from e
