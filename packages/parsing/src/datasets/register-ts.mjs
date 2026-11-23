import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./ts-js-hooks.mjs", import.meta.url));
