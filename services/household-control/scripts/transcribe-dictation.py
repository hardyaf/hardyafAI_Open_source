"""Transcribe an in-memory phone recording using a pinned local CPU model."""

import io
import json
import sys
from pathlib import Path

import av
import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16_000
MAX_SAMPLES = 30 * 60 * SAMPLE_RATE
MAX_BYTES = 12 * 1024 * 1024


class RecordingTooLong(Exception):
    pass


def decode_recording(data):
    pcm = bytearray()
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)

    def append(frames):
        for frame in frames:
            if len(pcm) // 2 + frame.samples > MAX_SAMPLES:
                raise RecordingTooLong
            pcm.extend(frame.to_ndarray().tobytes())

    with av.open(io.BytesIO(data), mode="r", format="mov", options={"enable_drefs": "0"}) as container:
        if len(container.streams.audio) != 1 or container.streams.video:
            raise ValueError
        audio = container.streams.audio[0]
        if audio.codec_context.name != "aac":
            raise ValueError
        for frame in container.decode(audio=0):
            append(resampler.resample(frame))
        append(resampler.resample(None))
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(model_path):
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) < 12 or len(data) > MAX_BYTES or data[4:8] != b"ftyp":
        return {"error": "invalid_dictation_audio"}
    try:
        audio = decode_recording(data)
    except RecordingTooLong:
        return {"error": "dictation_too_long"}
    except (av.error.FFmpegError, ValueError):
        return {"error": "invalid_dictation_audio"}
    if not audio.size:
        return {"text": ""}

    directory = Path(model_path).resolve(strict=True)
    for name in ("model.bin", "config.json", "tokenizer.json"):
        if not (directory / name).is_file():
            raise RuntimeError("local model incomplete")
    model = WhisperModel(str(directory), device="cpu", compute_type="int8", cpu_threads=4,
                         local_files_only=True)
    segments, _ = model.transcribe(audio, vad_filter=True, condition_on_previous_text=False, beam_size=3)
    return {"text": " ".join(segment.text.strip() for segment in segments if segment.text.strip())}


if __name__ == "__main__":
    print(json.dumps(transcribe(sys.argv[1]), ensure_ascii=False))
