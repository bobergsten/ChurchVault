# ChurchVault

Encrypted shared vault for a church (3-4 admins): logins, credit cards, door codes and secret documents. Data is encrypted end to end and synced through a private GitHub repository.

**For church members:** download from [Releases](https://github.com/bobergsten/ChurchVault/releases/latest) and follow the [installation and setup guide](docs/INSTALL.md), then read the [user manual](docs/USER-MANUAL.md).

Docs: [user manual](docs/USER-MANUAL.md) · [plan](docs/PLAN.md) · [security](docs/SECURITY.md) · [crypto](docs/CRYPTO.md) · [sync](docs/SYNC.md) · [members](docs/MEMBERS.md) · [releasing](docs/RELEASING.md)

## Development

```bash
npm install
npm run dev        # start the app
npm run typecheck && npm run lint && npm test
npm run build && npm run e2e   # end-to-end check of the real app (Linux: xvfb-run -a npm run e2e)
npm run dist       # build an installer for this OS into dist/ (releases: docs/RELEASING.md)
```
