import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLocalProject } from "./local-target.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

/** Generate original test footage only; outputs live under ignored test-results. */
export function generateVideoFixtures({
  root = defaultRoot,
  env = process.env,
  execute = execFileSync,
} = {}) {
  const target = readLocalProject(root);
  const output = join(target.workspace, "test-results", "generated-video");
  for (const directory of [join(target.workspace, "test-results"), output]) {
    mkdirSync(directory, { recursive: true });
    if (
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory) !== directory
    )
      throw new Error(
        "Video fixtures must be generated inside their owned regular directory.",
      );
  }
  const ffmpeg = env.WYP_FFMPEG_PATH || "ffmpeg";
  const run = (name, args) => {
    const path = join(output, name);
    try {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
        throw new Error("Unsafe fixture output.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    execute(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args, path],
      {
        cwd: target.workspace,
        shell: false,
        timeout: 120_000,
        maxBuffer: 64 * 1024,
        env: { PATH: env.PATH, LANG: "C", LC_ALL: "C" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (
      !statSync(path).isFile() ||
      statSync(path).size <= 0 ||
      statSync(path).size > 32 * 1024 * 1024
    )
      throw new Error("Generated video fixture exceeded its bounded size.");
    return path;
  };
  const source = [
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30:duration=15",
  ];
  const encode = [
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
  ];
  const withAudio = run("with-audio.mp4", [
    ...source,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=15",
    ...encode,
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-shortest",
  ]);
  const silent = run("silent.mp4", [...source, ...encode, "-an"]);
  // A fixed CBR stream exercises multiple real six-MiB TUS chunks without giant VOD fixtures.
  const resumable = run("resumable.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=16",
    ...encode,
    "-b:v",
    "8000k",
    "-minrate",
    "8000k",
    "-maxrate",
    "8000k",
    "-bufsize",
    "8000k",
    "-x264-params",
    "nal-hrd=cbr:force-cfr=1",
    "-an",
  ]);
  if (statSync(resumable).size <= 12 * 1024 * 1024)
    throw new Error(
      "Resumable video fixture must cross at least two chunk boundaries.",
    );
  return { directory: output, withAudio, silent, resumable };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("No fixture target override is permitted.");
    generateVideoFixtures();
    console.log(
      "Generated original local video fixtures under ignored test-results/generated-video.",
    );
  } catch {
    console.error(
      "Video fixture generation failed. Check FFmpeg and the owned local workspace.",
    );
    process.exitCode = 1;
  }
}
