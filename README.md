# MedOCR Hybrid Bench

Hybrid on-device and cloud medical document reading with stage-by-stage benchmarking. Built for #BuildHybridAI 2026 (Firebase AI Logic) and the SoalTech model-testing portal. See [design.md](design.md).

```bash
pnpm install
pnpm --filter @med-ocr/core test           # unit tests
pnpm --filter @med-ocr/web build           # web build
cp apps/web/.env.example apps/web/.env.local   # fill in your Firebase web config
pnpm --filter @med-ocr/web dev
python3 scripts/import_datasets.py amr --limit 5
```

License: Apache-2.0
