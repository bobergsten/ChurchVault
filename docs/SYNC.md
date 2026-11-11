# Git sync (`src/main/sync`)

Uses `isomorphic-git` (pure JS, no Git installation needed). The repository holds only `vault.json`, `members/*.json` and `entries/*.vault`: ciphertext and public keys.

**Sign-in:** a fine-grained GitHub personal access token limited to the one repository (Contents: read and write). It is stored with the OS keychain (`safeStorage`) and sent only to `github.com`: the address is checked to be `https://github.com/<owner>/<repo>` before anything is stored or sent. (OAuth device flow would need a registered GitHub OAuth app; not done.)

**When it syncs:** each save/delete is committed locally at once (messages never contain titles). With a remote set up, the app syncs on unlock, about 5 s after a change, every 5 minutes, and on "Sync now". Failures (offline, bad token) show in the header and never block local work.

**Merge policy** (file level, three-way against the merge base):

| Situation | Result |
|---|---|
| Only one side changed a file | that change is taken |
| Different entries edited on both sides | both kept |
| Same entry edited on both sides | the remote version keeps the original; ours is preserved as a flagged copy ("⚠ Conflict") that the user resolves: use it or discard it |
| We edited, they deleted | our edit is kept |
| They edited, we deleted | their edit is kept |
| Member file changed on both sides | remote version kept, reported |
| `vault.json` changed on both sides | sync stops with an error asking for manual attention |
| Someone pushes between fetch and push | fetch, merge and push again (up to 3 times) |
| Remote holds a different, unrelated vault | refused |

**Commit identity:** member name plus `<member-id>@members.churchvault.invalid`, so no real e-mail addresses end up in history.

**Tests** run the real protocol against bare repositories on disk (`local-http.ts` serves them through the system `git upload-pack` / `receive-pack`), including races and conflicts.
