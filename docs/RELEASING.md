# Releasing a new version

1. Update `"version"` in `package.json` (e.g. `0.2.0`), commit and push to `main`.
2. Tag and push:

   ```bash
   git tag v0.2.0
   ```

   ```bash
   git push origin v0.2.0
   ```

3. GitHub Actions (`.github/workflows/release.yml`) runs all checks, builds the macOS (Apple Silicon and Intel) and Windows installers, and attaches them to a **draft** release.
4. On github.com → Releases, open the draft, write a short "what changed", and **Publish**. Only published releases are offered to installed apps as updates.

Requirements:

- The code repository must be **public**; installed apps download updates without a token.
- Builds are unsigned. Anyone who can push a tag and publish a release in this repository can ship code to every member's computer, so keep that account protected (two-factor authentication) and review each draft before publishing.
