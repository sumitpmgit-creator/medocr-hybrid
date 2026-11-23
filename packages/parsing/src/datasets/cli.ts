// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { runDatasetImport } from "./import.js";

function usage(): string {
  return `Usage: node --experimental-strip-types --import <register> cli.ts import [options]

Options:
  --repo-root <dir>         Repository root (default: cwd)
  --bilingual-zip <path>    Local Mendeley v1 zip (sha256-pinned)
  --download-bilingual      Fetch the public v1 zip into datasets/raw/bilingual-prescriptions/

EkaCare is recorded as gated (no transcriptions) and is not downloaded.
African Medical Records at datasets/amr is described, not rewritten.
`;
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "help" || cmd === "-h") {
    process.stdout.write(usage());
    return 0;
  }
  if (cmd !== "import") {
    process.stderr.write(`Unknown command ${cmd}\n${usage()}`);
    return 2;
  }
  let repoRoot = process.cwd();
  let bilingualZip: string | undefined;
  let downloadBilingual = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo-root") {
      const v = args[++i];
      if (!v) throw new Error("--repo-root requires a path");
      repoRoot = resolve(v);
    } else if (a === "--bilingual-zip") {
      const v = args[++i];
      if (!v) throw new Error("--bilingual-zip requires a path");
      bilingualZip = resolve(v);
    } else if (a === "--download-bilingual") {
      downloadBilingual = true;
    } else {
      process.stderr.write(`Unknown option ${a}\n${usage()}`);
      return 2;
    }
  }
  const result = await runDatasetImport({
    repoRoot,
    bilingualZip,
    downloadBilingual,
    write: true,
  });
  const bilingualCount = result.bilingual?.imported_records ?? 0;
  process.stdout.write(
    `Imported bilingual-prescriptions: ${bilingualCount} records\n` +
      `Metadata: ${JSON.stringify(result.metadata.record_counts)}\n` +
      (result.bilingual && result.bilingual.warnings.length
        ? `Warnings: ${result.bilingual.warnings.length}\n`
        : ""),
  );
  return 0;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cli.ts") || entry.endsWith("cli.js") || entry.endsWith("cli.mjs")) {
  main(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
