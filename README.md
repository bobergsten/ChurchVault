# ChurchVault

Encrypted shared vault for a church (3-4 admins): logins, credit cards, door codes and secret documents. Data is encrypted end to end and synced through a private GitHub repository. See [docs/PLAN.md](docs/PLAN.md).

## Development

```bash
npm install
npm run dev        # start the app
npm run typecheck && npm run lint && npm test
npm run build && npm run e2e   # end-to-end check of the real app (Linux: xvfb-run -a npm run e2e)
npm run dist       # build installers (dmg / exe) into dist/
```
