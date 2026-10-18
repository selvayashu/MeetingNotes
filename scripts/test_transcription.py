#!/usr/bin/env python3
"""Check MeetNotes transcription quality for English, Hindi, Tamil and code-mixed speech.

Uses only the Python standard library. Sends each audio file to a running MeetNotes server and
compares the result with a reference transcript.

    python scripts/test_transcription.py --manifest tests/samples/manifest.csv
    python scripts/test_transcription.py --server https://api.example.com --token SECRET --manifest ... --max-cer 0.35

manifest.csv columns (paths are relative to the manifest):
    file,mode,reference
    en_01.wav,en,en_01.txt
    ta_en_01.m4a,ta-en,"இன்னைக்கு meeting-ல deadline பத்தி பேசினோம்"

mode is one of: en, hi, ta, auto, ta-en, hi-en. reference is a UTF-8 .txt file or the text itself.

Reports per file and per mode:
  WER        word error rate (lower is better)
  CER        character error rate; more meaningful than WER for Tamil and Hindi
  Latin%     share of Latin-script words in the output vs the reference: for code-mixed audio,
             this shows whether English words stay in English or get transliterated
  RTF        processing time / audio duration (below 1.0 is faster than real time)
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    text = "".join(" " if unicodedata.category(ch).startswith(("P", "S")) else ch for ch in text)
    return " ".join(text.split())


def edit_distance(a: list, b: list) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def error_rate(hyp: list, ref: list) -> float:
    return edit_distance(hyp, ref) / max(1, len(ref))


def latin_share(text: str) -> float:
    words = text.split()
    if not words:
        return 0.0
    latin = sum(1 for w in words if any("a" <= c <= "z" for c in w))
    return latin / len(words)


def multipart(fields: dict[str, str], file_field: str, path: Path) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{path.name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode() + path.read_bytes() + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def call(server: str, token: str, path: str, data: bytes | None = None, content_type: str | None = None) -> dict:
    req = urllib.request.Request(server.rstrip("/") + path, data=data, method="POST" if data else "GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{path}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Cannot reach {server}: {e.reason}")


def transcribe(server: str, token: str, audio: Path, mode: str) -> tuple[dict, float]:
    body, ctype = multipart({"language": mode}, "file", audio)
    start = time.time()
    job = call(server, token, "/api/jobs/transcribe", body, ctype)
    while True:
        time.sleep(1)
        status = call(server, token, f"/api/jobs/{job['id']}")
        if status["status"] == "done":
            return status["result"], time.time() - start
        if status["status"] == "error":
            raise RuntimeError(status["error"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default="http://localhost:8000")
    parser.add_argument("--token", default="", help="ACCESS_TOKEN, if set on the server")
    parser.add_argument("--manifest", default="tests/samples/manifest.csv")
    parser.add_argument("--max-cer", type=float, default=None, help="exit 1 if any file's CER is above this")
    parser.add_argument("--show", action="store_true", help="print hypothesis and reference text")
    parser.add_argument("--json", dest="json_out", help="write detailed results to this JSON file")
    args = parser.parse_args()

    manifest = Path(args.manifest)
    if not manifest.exists():
        print(f"Manifest not found: {manifest}. See tests/samples/README.md.", file=sys.stderr)
        return 2
    health = call(args.server, args.token, "/api/health")
    print(f"Server {health['version']} · STT {health['stt']['default']} · routes {health['stt']['routes'] or '-'}\n")

    rows = list(csv.DictReader(manifest.open(encoding="utf-8")))
    results, by_mode = [], defaultdict(list)
    print(f"{'file':32} {'mode':6} {'det':4} {'WER':>6} {'CER':>6} {'Latin% out/ref':>15} {'RTF':>5}")
    for row in rows:
        audio = manifest.parent / row["file"]
        ref_field = row["reference"]
        ref_path = manifest.parent / ref_field
        reference = ref_path.read_text(encoding="utf-8") if ref_field.endswith(".txt") and ref_path.exists() else ref_field
        result, elapsed = transcribe(args.server, args.token, audio, row["mode"])
        hyp, ref = normalize(result["text"]), normalize(reference)
        wer = error_rate(hyp.split(), ref.split())
        cer = error_rate(list(hyp.replace(" ", "")), list(ref.replace(" ", "")))
        rtf = elapsed / max(0.1, result["duration"])
        entry = {
            "file": row["file"], "mode": row["mode"], "detected": result["language"], "wer": wer, "cer": cer,
            "latin_out": latin_share(hyp), "latin_ref": latin_share(ref), "rtf": rtf,
            "hypothesis": result["text"], "reference": reference,
        }
        results.append(entry)
        by_mode[row["mode"]].append(entry)
        print(f"{row['file'][:32]:32} {row['mode']:6} {str(result['language'] or '-'):4} {wer:6.1%} {cer:6.1%} "
              f"{entry['latin_out']:7.0%}/{entry['latin_ref']:<7.0%} {rtf:5.2f}")
        if args.show:
            print(f"   HYP: {result['text']}\n   REF: {reference.strip()}")

    print("\nAverages by mode")
    for mode, entries in sorted(by_mode.items()):
        avg = lambda key: sum(e[key] for e in entries) / len(entries)  # noqa: E731
        print(f"  {mode:6} n={len(entries):<3} WER {avg('wer'):6.1%}  CER {avg('cer'):6.1%}  RTF {avg('rtf'):.2f}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.max_cer is not None:
        worst = [e for e in results if e["cer"] > args.max_cer]
        if worst:
            print(f"\nFAIL: {len(worst)} file(s) above CER {args.max_cer:.0%}: {', '.join(e['file'] for e in worst)}")
            return 1
        print(f"\nPASS: all files at or below CER {args.max_cer:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
