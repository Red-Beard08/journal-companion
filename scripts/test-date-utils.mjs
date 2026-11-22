import assert from "node:assert/strict";
import { build } from "esbuild";

process.env.TZ = "America/Chicago";
const result = await build({ entryPoints: ["src/date-utils.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { localDateKey } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

assert.equal(localDateKey(new Date(2026, 10, 22, 0, 15)), "2026-11-22");
assert.equal(localDateKey(new Date("2026-11-22T01:00:00Z")), "2026-11-21", "date keys must follow the device's local calendar");
assert.equal(localDateKey(new Date(2026, 2, 8, 12)), "2026-03-08", "calendar dates must remain stable across DST changes");
console.log("Local calendar date tests passed.");
