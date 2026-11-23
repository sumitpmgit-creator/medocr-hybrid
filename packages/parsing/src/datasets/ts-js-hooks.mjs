import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
    const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (existsSync(fileURLToPath(tsUrl))) {
      return nextResolve("./" + specifier.slice(2, -3) + ".ts", context);
    }
  }
  return nextResolve(specifier, context);
}
