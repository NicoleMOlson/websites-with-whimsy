import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const output = resolve(root, "dist");
const publicFiles = ["index.html", "terms.html", "privacy.html", "styles.css", "script.js", "cloud.js"];
const requiredVariables = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_URL"];

const missing = requiredVariables.filter(name => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Missing required build variables: ${missing.join(", ")}`);
}

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL.trim(),
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY.trim(),
  APP_URL: process.env.APP_URL.trim()
};

if (!/^https:\/\/.+\.supabase\.co$/.test(config.SUPABASE_URL)) {
  throw new Error("SUPABASE_URL must be a hosted Supabase project URL.");
}

if (!/^https:\/\//.test(config.APP_URL)) {
  throw new Error("APP_URL must be the full HTTPS URL of the deployed Worker.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(publicFiles.map(file => copyFile(resolve(root, file), resolve(output, file))));
await writeFile(
  resolve(output, "config.js"),
  `window.WHIMSY_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
  "utf8"
);

console.log(`Built ${publicFiles.length + 1} static assets in dist/.`);
