#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
Dataset importer -> datasets/<name>/manifest.jsonl (one DatasetItem per line, see packages/core/src/types.ts).
Records dataset revision (Hugging Face commit sha) and license for every item, per the SoalTech spec.

Usage:
  python3 scripts/import_datasets.py amr --limit 5          # African Medical Records (public, CC-BY-4.0): image + transcription
  python3 scripts/import_datasets.py words --limit 10       # Medical Prescription Handwritten Words (public, MIT): images only
  HF_TOKEN=hf_xxx python3 scripts/import_datasets.py ekacare --limit 20
      # EkaCare (MIT, but GATED on Hugging Face): log in, click "Agree" on
      # https://huggingface.co/datasets/ekacare/medical_records_parsing_validation_set
      # then create a read token. Needs: pip install pyarrow
      # NOTE: EkaCare publishes images + prompts + rubrics, NOT transcriptions or ground-truth JSON,
      # so it supports rubric scoring (Benchmark B via LLM judge), not CER.

Only the standard library is required except for EkaCare (pyarrow).
"""
import argparse, base64, hashlib, json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HF = "https://huggingface.co"

def get(url, token=None):
    req = urllib.request.Request(url, headers={"User-Agent": "med-ocr-importer"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

def info(repo, token=None):
    j = json.loads(get(f"{HF}/api/datasets/{repo}", token))
    lic = next((t.split(":", 1)[1] for t in j.get("tags", []) if t.startswith("license:")), "unknown")
    return j["sha"], lic, [s["rfilename"] for s in j.get("siblings", [])], j.get("gated", False)

def write_manifest(out_dir, items):
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "manifest.jsonl", "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"wrote {len(items)} items -> {out_dir/'manifest.jsonl'}")

def amr(out, limit):
    repo = "Nigeria-Health-data-OCR-pipeline/African-Medical-Records"
    sha, lic, files, _ = info(repo)
    truths = sorted(f for f in files if f.startswith("truth/") and f.endswith(".txt"))
    items = []
    for t in truths:
        doc = Path(t).stem  # AMR_001
        imgs = sorted(f for f in files if f.startswith("htr/") and Path(f).name.startswith(doc + "_"))
        if len(imgs) != 1:  # single-page docs only (Nano: one image per call)
            continue
        img = imgs[0]
        dest = out / "images" / Path(img).name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(get(f"{HF}/datasets/{repo}/resolve/{sha}/{img}"))
        text = get(f"{HF}/datasets/{repo}/resolve/{sha}/{t}").decode("utf-8", "replace")
        items.append({"id": f"amr/{doc}", "dataset": repo, "datasetVersion": sha, "license": lic,
                      "imagePath": str(dest.relative_to(ROOT)), "documentType": "clinical_note",
                      "referenceText": text, "handwritten": True})
        if len(items) >= limit:
            break
    write_manifest(out, items)

def words(out, limit):
    repo = "avi-kai/Medical_Prescription_Handwritten_Words"
    sha, lic, files, _ = info(repo)
    imgs = sorted((f for f in files if f.endswith(".png")), key=lambda f: int(Path(f).stem) if Path(f).stem.isdigit() else 0)[:limit]
    items = []
    for img in imgs:
        dest = out / "images" / Path(img).name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(get(f"{HF}/datasets/{repo}/resolve/{sha}/{img}"))
        items.append({"id": f"words/{Path(img).stem}", "dataset": repo, "datasetVersion": sha, "license": lic,
                      "imagePath": str(dest.relative_to(ROOT)), "documentType": "word",
                      "handwritten": True, "note": "labels not in repo listing; verify dataset card before using for CER"})
    write_manifest(out, items)

def ekacare(out, limit):
    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("EkaCare is gated: set HF_TOKEN after accepting the terms on the dataset page.")
    try:
        import pyarrow.parquet as pq, io
    except ImportError:
        sys.exit("pip install pyarrow")
    repo = "ekacare/medical_records_parsing_validation_set"
    sha, lic, files, gated = info(repo, token)
    items = []
    for shard in sorted(f for f in files if f.endswith(".parquet")):
        table = pq.read_table(io.BytesIO(get(f"{HF}/datasets/{repo}/resolve/{sha}/{shard}", token)))
        for row in table.to_pylist():
            img = row["image"]; data = img.get("bytes") if isinstance(img, dict) else img
            ext = ".png" if data[:4] == b"\x89PNG" else ".jpg"
            md5 = row.get("md5_image") or hashlib.md5(data).hexdigest()
            dest = out / "images" / f"{md5}{ext}"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            rub = row.get("rubrics")
            try:
                rub = json.loads(rub) if isinstance(rub, str) else rub
            except json.JSONDecodeError:
                rub = [rub]
            items.append({"id": f"ekacare/{md5}", "dataset": repo, "datasetVersion": sha, "license": lic,
                          "imagePath": str(dest.relative_to(ROOT)), "documentType": row.get("document_type"),
                          "prompt": row.get("sample_prompt"), "rubrics": rub})
            if len(items) >= limit:
                return write_manifest(out, items)
    write_manifest(out, items)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source", choices=["amr", "words", "ekacare"])
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    out = a.out or ROOT / "datasets" / a.source
    {"amr": amr, "words": words, "ekacare": ekacare}[a.source](out.resolve(), a.limit)
