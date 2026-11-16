---
name: release
description: Prepare, authorize, publish, troubleshoot, and verify Cursor BYOK desktop GitHub Releases. Use for version bumps, release tags, GitHub Actions release runs, updater manifests, signing, or release-readiness checks.
---

# Desktop release

Release through `.github/workflows/release.yml`. Preserve both updater formats: Tauri uses `latest.json`; legacy `v0.0.49` clients use `update.json`.

## Publication authority

- This fork releases only to `bargino/cursor-byok`. Only its owner, GitHub user `bargino`, may authorize a live release.
- Before any live mutation, require an explicit release instruction from the owner in the current task and verify the authenticated GitHub account is `bargino`, using the connected GitHub account or `gh api user --jq .login`.
- Treat all of these as publication actions: pushing a `v*` tag, manually dispatching or rerunning the release workflow, and publishing or editing a GitHub Release. Pushing a release commit to `main` only prepares the release and must never trigger publication by itself.
- Without that authorization, restrict work to inspection, local edits, validation, and a release-ready commit or branch. Do not infer publication permission from requests such as “prepare”, “check”, or “ready to release”.
- Never print, commit, or upload `.tauri/cursor-byok.key` anywhere except the repository's `TAURI_SIGNING_PRIVATE_KEY` Actions Secret when the author explicitly requests that secret configuration.
- Never delete, replace, or move an existing tag or published Release without separate explicit authorization.

## Version and GitHub Release policy

- Do not use GitHub prereleases. Keep `prerelease: false` for every release and publish the completed release as Latest.
- Use `vMAJOR.MINOR.PATCH` for a stable tag, for example `v0.1.0`.
- Use standard SemVer `vMAJOR.MINOR.PATCH-beta.N` for a test tag, for example `v0.1.0-beta.1`. A beta is still a normal GitHub Release, not a GitHub prerelease. Make its title or body visibly say Beta.
- This normal-Release rule is required because both installed update clients resolve assets through GitHub's `/releases/latest/download/` path, which excludes GitHub prereleases.
- Windows beta builds must use the NSIS bundle. WiX/MSI rejects nonnumeric prerelease identifiers such as `beta.1`; do not weaken the SemVer tag to accommodate MSI.
- Release only from a `v*` tag whose commit is contained in `origin/main`. The tag must equal `v<version>` from the desktop manifests.
- Keep ordinary `main` pushes disabled as release triggers. The owner pushes the matching tag only after the release commit is present on `origin/main`. If a tag push does not start a run, the owner may manually dispatch the workflow with that existing tag. Manual dispatch must validate the tag, manifest version, checked-out commit, and containment in `origin/main`; every build job checks out the validated tag.
- Never republish an already published version. Select a new version instead.

## Release sources

Keep the desktop version identical in the manifests and their locks:

```text
cursor-byok/
├── Cargo.lock
├── apps/desktop/
│   ├── package.json
│   ├── package-lock.json
│   └── src-tauri/
│       ├── Cargo.toml
│       └── tauri.conf.json
├── protocols/cursor/
│   ├── agent_v1.proto
│   ├── aiserver_v1.proto
│   └── aiserver_run_inference_v1.proto
└── .github/workflows/release.yml
```

The three listed Proto files are required build inputs and must be committed. Keep the other locally extracted Proto files ignored unless the build starts depending on them.

## Prepare and validate

1. Inspect `git status`, fetch `origin/main`, and preserve unrelated user changes. Confirm the release commit is based on the current remote head.
2. Choose stable or beta numbering explicitly. Update the desktop version in both manifests and lockfiles; do not change the independent `cursor-server` version merely to release the desktop app.
3. Confirm the updater public key in `tauri.conf.json` matches `.tauri/cursor-byok.key.pub` without exposing the private key.
4. Confirm `TAURI_SIGNING_PRIVATE_KEY` exists in GitHub Actions. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must be absent when the local key has no password.
5. Confirm neither the intended tag nor Release already exists.
6. From `apps/desktop`, run:

   ```bash
   npm run check
   npm run tauri:build -- --debug --no-bundle
   ```

7. Validate the workflow YAML and inspect the staged diff. Ensure `.tauri/`, unrelated local files, and unrelated user changes are not staged.
8. Use the `tauri-action@v1` input `uploadUpdaterJson: true`; `includeUpdaterJson` is not a valid v1 input.
9. Stable Windows releases include both NSIS and MSI; keep `updaterJsonPreferNsis: true`. Check that the release notes exist at `support/releases/v<version>.md` and that the checksum step covers all uploaded assets before publication.
10. Set `releaseCommitish` to the repository's default branch after validating that the version tag already exists. This controls release metadata; builds still check out the validated tag. A stale workflow commit as the release target can require a Workflows permission that `GITHUB_TOKEN` cannot obtain.

## Publish and verify

After the author explicitly authorizes publication:

1. Commit only the reviewed release set and push it to `main`. Confirm the release commit is present in `origin/main`; this push must not start the release workflow.
2. Create the matching tag on that commit, for example `v0.1.0-beta.1`, and push only that tag. This tag push is the publication trigger. If GitHub does not create a run, manually dispatch the release workflow using the existing tag input; never move the tag to retry.
3. Follow the triggered `Release desktop app` run through completion. Report the run URL and stop on failure; diagnose locally before asking the author to authorize another live attempt.
4. Verify `v<version>` exists, is published rather than draft, has `prerelease: false`, and is the repository's Latest release.
5. Verify the Release contains signed Tauri updater artifacts plus `latest.json`, and the legacy platform archives plus `update.json`.
6. For a beta, report clearly that it is a test version even though GitHub represents it as a normal Latest Release.
