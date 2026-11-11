# Releasing a new version

1. Raise `"version"` in `package.json` (e.g. `0.2.0`) and merge that change into `main`. The first release, `0.1.0`, needs no change.
2. Start the release, either way:
   - **In the browser:** github.com → **Actions** → **Release** → **Run workflow** (branch `main`) → **Run workflow**. The workflow creates the tag (`v0.2.0`) itself.
   - **From a terminal:** tag the commit on `main` and push the tag:

     ```bash
     git tag -a v0.2.0 -m "ChurchVault 0.2.0"
     ```

     ```bash
     git push origin v0.2.0
     ```

3. The workflow (`.github/workflows/release.yml`) creates one **draft** release, runs all checks, then builds the macOS (Apple Silicon and Intel) and Windows installers and attaches them to that draft. It refuses to run if the tag doesn't match `package.json`, if the version is already published, or (when started by hand) if the tag already exists on a different commit.

   **If a release run goes wrong** before publishing: delete its draft(s) on the Releases page, keep the tag, and use **Run workflow** again. It rebuilds the same version as long as the tag points at the latest commit on `main`.
4. On github.com → **Releases**, open the draft, write a short "what changed", and **Publish**. Only published releases are offered to installed apps as updates.

Requirements:

- The code repository must be **public**; installed apps download updates without a token.
- Builds are unsigned. Anyone who can start this workflow or push a tag, and publish a release, can ship code to every member's computer. Keep the account protected with two-factor authentication and review each draft before publishing.
