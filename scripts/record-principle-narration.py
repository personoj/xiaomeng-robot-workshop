"""Record exact teaching narration with the configured Xiaomeng voice.

Uses isolated provider connections, never an existing Harness/device session.
Credentials remain in the sibling project's local Settings and are not printed.
Run with the project's authorized Python executable; no extra dependencies beyond
the existing realtime project are required.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import unicodedata
import wave
from array import array

ROOT = Path(__file__).resolve().parents[1]
REALTIME_ROOT = ROOT.parent / "xiaoyun-realtime"
sys.path.insert(0, str(REALTIME_ROOT))

from xiaoyun.config import Settings  # noqa: E402
from xiaoyun.provider import QwenProvider  # noqa: E402

SAMPLE_RATE = 24000
NARRATION = ROOT / "frontend" / "principle-narration.json"
AUDIO_DIR = ROOT / "frontend" / "public" / "principles" / "audio"
CACHE_DIR = ROOT / ".local" / "principle-narration"
INSTRUCTIONS = (
    "你是小萌的中文科普配音员。只逐字朗读用户给出的正文，绝不增删改写，"
    "不加开场、确认、总结，不念引号，不解释要求。使用自然、温和、清晰的中文，"
    "语速适中，适合跟随数学动画理解。句中逻辑转折稍作自然停顿，不拖长尾音，"
    "不夸张表演。这些句子属于同一节连贯讲解，不要每次使用开场介绍语气。"
)


def normalized(text: str) -> str:
    """Ignore punctuation/spacing only; all semantic characters must match."""
    return re.sub(r"[\W_]", "", unicodedata.normalize("NFKC", text), flags=re.UNICODE).lower()


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError("cached_audio_format_mismatch")
        return source.readframes(source.getnframes())


def write_pcm(path: Path, pcm: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(SAMPLE_RATE)
        target.writeframes(pcm)


def trim_silence(pcm: bytes) -> tuple[bytes, dict]:
    """Remove only leading/trailing quiet windows, preserving 100 ms handles."""
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    block = SAMPLE_RATE // 100
    active = []
    for start in range(0, len(samples), block):
        values = samples[start:start + block]
        if values and (max(abs(x) for x in values) >= 180
                       or math.sqrt(sum(x*x for x in values) / len(values)) >= 55):
            active.append(start)
    if not active:
        raise ValueError("empty_audio")
    padding = SAMPLE_RATE // 10
    start = max(0, active[0] - padding)
    end = min(len(samples), active[-1] + block + padding)
    return pcm[start*2:end*2], {
        "originalSamples": len(samples), "trimmedLeadingSamples": start,
        "trimmedTrailingSamples": len(samples) - end,
    }


async def synthesize(settings: Settings, text: str) -> tuple[bytes, str]:
    provider = QwenProvider(settings)
    try:
        await provider.connect(INSTRUCTIONS, [])
        await provider.send({
            "type": "conversation.item.create", "item": {
                "type": "message", "role": "user",
                "content": [{"type": "input_text", "text": "请只逐字朗读这一句：\n" + text}],
            },
        })
        await provider.send({"type": "response.create", "response": {"modalities": ["text", "audio"]}})
        chunks: list[bytes] = []
        transcript = ""
        final_transcript = ""
        async with asyncio.timeout(90):
            async for event in provider.events():
                kind = event.get("type")
                if kind == "response.audio.delta":
                    chunks.append(base64.b64decode(event["delta"]))
                elif kind == "response.audio_transcript.delta":
                    transcript += event.get("delta", "")
                elif kind == "response.audio_transcript.done":
                    final_transcript = event.get("transcript", "")
                elif kind == "error":
                    raise RuntimeError("provider_response_error")
                elif kind == "response.done":
                    if event.get("response", {}).get("status") not in (None, "completed"):
                        raise RuntimeError("provider_response_incomplete")
                    break
        pcm = b"".join(chunks)
        transcript = final_transcript or transcript
        if not pcm or len(pcm) % 2:
            raise ValueError("missing_or_invalid_pcm")
        if normalized(transcript) != normalized(text):
            raise ValueError("narration_text_mismatch")
        return pcm, transcript
    finally:
        await provider.close()


async def record_beat(settings: Settings, topic: str, index: int, beat_index: int,
                      beat: dict, semaphore: asyncio.Semaphore, args) -> bytes:
    text = beat["text"]
    digest = hashlib.sha256((settings.model + "\n" + settings.voice + "\n" + text).encode()).hexdigest()
    cache_file = CACHE_DIR / f"{topic}-{index}-{beat_index}-{digest[:12]}.wav"
    cache_meta = cache_file.with_suffix(".json")
    async with semaphore:
        if not args.force and cache_file.exists() and cache_meta.exists():
            metadata = json.loads(cache_meta.read_text(encoding="utf-8"))
            if metadata.get("digest") == digest and normalized(metadata.get("transcript", "")) == normalized(text):
                pcm = read_pcm(cache_file)
                beat.update(seconds=len(pcm) / (2*SAMPLE_RATE), samples=len(pcm)//2,
                            transcript=metadata["transcript"], transcriptVerified=True)
                print(f"cached {topic}/{index}/{beat_index}: {beat['seconds']:.3f}s", flush=True)
                return pcm
        for attempt in range(args.retries):
            try:
                raw_pcm, transcript = await synthesize(settings, text)
                pcm, trim = trim_silence(raw_pcm)
                write_pcm(cache_file, pcm)
                metadata = {"digest": digest, "transcript": transcript, "text": text, **trim}
                cache_meta.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                beat.update(seconds=len(pcm) / (2*SAMPLE_RATE), samples=len(pcm)//2,
                            transcript=transcript, transcriptVerified=True)
                print(f"recorded {topic}/{index}/{beat_index}: {beat['seconds']:.3f}s", flush=True)
                return pcm
            except Exception as exc:
                # Avoid transport exception strings: they could include connection details.
                print(f"retry {topic}/{index}/{beat_index} ({attempt+1}/{args.retries}): {type(exc).__name__}", flush=True)
                if attempt + 1 >= args.retries:
                    raise RuntimeError(f"recording_failed:{topic}/{index}/{beat_index}") from None
                await asyncio.sleep(1 + attempt)
    raise AssertionError("unreachable")


async def main(args) -> None:
    settings = Settings.load()
    settings.turn_detection = "manual"
    data = json.loads(NARRATION.read_text(encoding="utf-8"))
    data.update(voice=settings.voice, model=settings.model, sampleRate=SAMPLE_RATE)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(args.workers)
    selected = {k: v for k, v in data["topics"].items() if not args.topic or k in args.topic}
    async def record_topic(topic: str, contents: dict) -> None:
        chapter_audio = []
        for index, step in enumerate(contents["steps"]):
            results = await asyncio.gather(*(record_beat(settings, topic, index, n, beat, semaphore, args)
                                             for n, beat in enumerate(step["beats"])))
            pcm = b"".join(results)
            filename = f"{topic}-{index}.wav"
            write_pcm(AUDIO_DIR / filename, pcm)
            cursor = 0
            for beat in step["beats"]:
                beat["start"] = cursor / SAMPLE_RATE
                cursor += beat["samples"]
            step.update(speech="".join(b["text"] for b in step["beats"]), seconds=len(pcm)/(2*SAMPLE_RATE),
                        samples=len(pcm)//2, audio="/principles/audio/" + filename)
            chapter_audio.append(pcm)
        total = b"".join(chapter_audio)
        write_pcm(AUDIO_DIR / f"{topic}.wav", total)
        cursor = 0
        for step in contents["steps"]:
            step["start"] = cursor / SAMPLE_RATE
            cursor += step["samples"]
        contents.update(seconds=len(total)/(2*SAMPLE_RATE), samples=len(total)//2,
                        audio=f"/principles/audio/{topic}.wav")
        print(f"COMPLETE {topic}: {contents['seconds']:.3f}s", flush=True)
    await asyncio.gather(*(record_topic(k, v) for k, v in selected.items()))
    data["status"] = "recorded" if all(v.get("audio") for v in data["topics"].values()) else "partially_recorded"
    NARRATION.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Narration manifest updated; isolated provider sessions closed.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", action="append", help="Record one named topic; may be repeated")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--force", action="store_true")
    arguments = parser.parse_args()
    if not 1 <= arguments.workers <= 4:
        parser.error("workers must be between one and four")
    asyncio.run(main(arguments))
