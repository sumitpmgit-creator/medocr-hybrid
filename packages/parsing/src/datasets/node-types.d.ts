// Minimal Node typings for the dataset importer.
// packages/parsing/tsconfig.json sets "types": [] and the workspace
// does not include @types/node, so these declarations stay local.

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean },
  ): string | undefined;
  export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string },
  ): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number };
  export function copyFileSync(src: string, dest: string): void;
  export function createReadStream(path: string): {
    on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
    on(event: "error", listener: (err: Error) => void): unknown;
    on(event: "end", listener: () => void): unknown;
  };
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function copyFile(src: string, dest: string): Promise<void>;
}

declare module "node:path" {
  const path: {
    join(...parts: string[]): string;
    dirname(path: string): string;
    basename(path: string, ext?: string): string;
    extname(path: string): string;
    resolve(...parts: string[]): string;
    relative(from: string, to: string): string;
    posix: { join(...parts: string[]): string };
  };
  export default path;
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): unknown;
    digest(encoding: "hex"): string;
  };
}

declare module "node:process" {
  const process: {
    argv: string[];
    cwd(): string;
    exit(code?: number): never;
    exitCode?: number;
    stderr: { write(s: string): void };
    stdout: { write(s: string): void };
  };
  export default process;
}

declare module "node:module" {
  export function register(specifier: string | URL, parentURL?: string | URL): void;
}

declare module "node:stream/consumers" {
  export function arrayBuffer(stream: unknown): Promise<ArrayBuffer>;
}

declare const process: {
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
  exitCode?: number;
  stderr: { write(s: string): void };
  stdout: { write(s: string): void };
};
