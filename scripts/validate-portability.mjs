import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd(); const files = [];
function walk(dir) { for (const name of readdirSync(dir)) { if (["node_modules", ".git", "main.js"].includes(name)) continue; const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else files.push(path); } }
walk(root);
const bad = [];
for (const file of files) { if (file.endsWith("validate-portability.mjs")) continue; let text; try { text = readFileSync(file, "utf8"); } catch { continue; } if (text.includes("C:\\Users\\") || /iCloud/i.test(text) || /Collections[\\/]/i.test(text) || /Red-Beard's Dashboard/i.test(text)) bad.push(file); }
if (bad.length) throw new Error(`Non-portable references found:\n${bad.join("\n")}`);
console.log("Journal Companion portability validation passed.");
