import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, "..");
const output = resolve(source, "dist");
const push = process.argv.slice(2).includes("--push");
if (process.argv.slice(2).some((arg) => arg !== "--push")) {
  throw new Error("Use node site/publish.mjs [--push]");
}
const git = (args, env = process.env) =>
  execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const project = JSON.parse(
  await readFile(join(source, "project.json"), "utf8"),
);
const remote = git(["remote", "get-url", "origin"]).replace(/\.git$/, "");
if (remote !== project.repository) {
  throw new Error(
    "Origin must match the project repository before publication",
  );
}
const sourceCommit = git(["rev-parse", "HEAD"]);
const remoteMain = git(["ls-remote", "origin", "refs/heads/main"]).split(
  /\s+/,
)[0];
if (sourceCommit !== remoteMain) {
  throw new Error("Push the reviewed source commit to main before publishing");
}
if (push) {
  const changed = git([
    "status",
    "--porcelain",
    "--",
    "site",
    "images/en-home-1.png",
    "assets/banners/cursor-byok/minimalist-en-1280x640.png",
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/icons/linux-512x512.png",
  ]);
  if (changed)
    throw new Error("Commit website source changes before publishing");
}
execFileSync(process.execPath, [join(source, "build.mjs")], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(
  process.platform === "win32" ? "python" : "python3",
  [join(source, "check.py")],
  { cwd: root, stdio: "inherit" },
);

const previous = git(["ls-remote", "--heads", "origin", "gh-pages"]).split(
  /\s+/,
)[0];
if (!previous)
  throw new Error("Configure the gh-pages publication branch first");
git(["fetch", "--no-tags", "origin", "gh-pages"]);
const temporary = await mkdtemp(join(tmpdir(), "cursor-byok-pages-"));
const index = join(temporary, "index");
const environment = { ...process.env, GIT_INDEX_FILE: index };
try {
  git(["read-tree", "--empty"], environment);
  git([`--work-tree=${output}`, "add", "--force", "--all"], environment);
  const tree = git(["write-tree"], environment);
  const previousTree = git(["rev-parse", `${previous}^{tree}`]);
  const changes = git(["diff", "--stat", previousTree, tree]);
  console.log(
    changes || "Published static files already match the reviewed source.",
  );
  if (tree !== previousTree && push) {
    const commit = git([
      "commit-tree",
      tree,
      "-p",
      previous,
      "-m",
      `docs: deploy static site from ${sourceCommit}`,
    ]);
    // A concurrent publisher causes a normal non-fast-forward rejection; never force-push.
    console.log(git(["push", "origin", `${commit}:refs/heads/gh-pages`]));
    console.log(`Published ${commit} from source ${sourceCommit}`);
  } else if (!push) {
    console.log(
      "Preview only. Use --push after reviewing the static-file changes.",
    );
  }
} finally {
  await unlink(index).catch(() => {});
  await rmdir(temporary).catch(() => {});
}
