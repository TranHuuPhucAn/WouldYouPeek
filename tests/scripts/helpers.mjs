import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export function fixtureProject(t) {
  const root = mkdtempSync(join(tmpdir(), "wyp-script-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  const config = readFileSync(fileURLToPath(new URL("../../supabase/config.toml", import.meta.url)), "utf8")
    .replace(/^project_id\s*=.*$/m, 'project_id = "would-you-peek"')
    .replace(/\b5532([0-6])\b/g, "5432$1").replace(/:3100\b/g, ":3000")
    .replace(/^site_url\s*=.*$/m, 'site_url = "http://127.0.0.1:3000"');
  writeFileSync(join(root, "supabase/config.toml"), config);
  writeFileSync(join(root, "supabase/migrations/20261117000500_baseline.sql"), "-- baseline\n");
  writeFileSync(join(root, "supabase/migrations/20261118000100_new.sql"), "-- new\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/example.ts"), "export const example = 1;\n");
  writeFileSync(join(root, ".env.local"), "PRIVATE_TEST_SENTINEL=do-not-copy\n");
  mkdirSync(join(root, ".next"));
  writeFileSync(join(root, ".next/sentinel"), "preserve");
  return root;
}

export function fixtureEnvironment(target) {
  return {
    PATH: process.env.PATH, WYP_TEST_WORKSPACE: target.workspace,
    WYP_TEST_RUN_ID: target.runId, WYP_TEST_PROJECT_ID: target.projectId,
    SUPABASE_TEST_URL: "http://127.0.0.1:55321", SUPABASE_TEST_MAIL_URL: "http://127.0.0.1:55324",
    SUPABASE_TEST_APP_URL: "http://localhost:3100", SUPABASE_TEST_SERVICE_ROLE_KEY: "test-admin-only",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public",
    NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  };
}
