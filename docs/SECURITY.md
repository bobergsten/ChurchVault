# Security

## Threat model

| Who | Can do | Protection |
|---|---|---|
| GitHub (or anyone who obtains the repo) | Read every file and its history | Everything secret is encrypted on the members' computers before upload. GitHub sees file counts, sizes, commit times and member names. |
| Someone with **write** access to the repo but not the vault (hijacked GitHub account, rogue collaborator) | Change or add files | See "Repository tampering" below. They can always break things (delete files, block sync). They cannot read secrets or get a member to use a key they know. |
| Thief of a locked laptop | Copy the app's files | Vault key exists only in memory while unlocked. Files on disk: Argon2id-protected member key (256 MiB, 3 passes), SQLCipher index, GitHub token in the OS keychain. Strength of the member's password is what matters. |
| Someone at an unlocked computer | Use the app | Auto-lock after 5 minutes idle, on screen lock and on sleep. Secrets masked until revealed, re-masked after 20 s. |
| Malware running as the user | Anything the user can | Out of scope (no desktop app can defend against this). |
| A removed member | Whatever they saw or copied before | Key rotation stops access to anything new. Old secrets must be changed by hand (the app says so). |

## Repository tampering (found in the milestone 8 review, fixed)

Two attacks were possible for someone with only write access to the repository:

1. **Planting a vault key.** Sealed boxes are anonymous, so anyone could seal a key *they* chose to a member's public key. The member would unlock without error and save new entries under the attacker's key.
2. **Swapping a public key.** Replacing a member's public key in `members/<id>.json` would make the next key rotation seal the new vault key to the attacker.

Fixes:

- **Trusted key per computer** (`trusted-key.json` in the app data folder: generation and a hash of the vault key, no secret). Unlock is refused unless the key is the one trusted before, or a newer key that leads back to it through the **key chain**.
- **Key chain** in `vault.json`: each rotation stores the previous key encrypted with the new one. Only someone holding the old key can make a valid link.
- **Member attestation**: every member file with access carries a MAC over vault id, member id, name and public key, keyed from the vault key. A modified file shows "could not be verified" in *Members*, and key rotation refuses to seal to it until that member is removed.
- **First unlock on a new computer** (nothing trusted yet): the key must be able to read the existing entries, else unlock is refused. Residual risk: an attacker who replaces the *entire* vault (all entries too) could fool a brand-new computer into an empty fake vault. The joining person would notice that the vault is empty, and nothing from the real vault leaks.

## Electron hardening

- Renderer: `contextIsolation`, `sandbox`, no Node, no `<webview>`, spellcheck off. Served from a custom `app://bundle` scheme (not `file://`) restricted to the built UI folder.
- Content-Security-Policy header: no network access, no inline scripts, no plugins, no framing. Images only from the bundle or `data:` (attachment previews of PNG/JPEG/GIF/WebP; SVG is never rendered).
- IPC: only accepted from the top frame of our own window at our own origin; every argument is validated in the main process; errors never contain secrets.
- All permission requests (camera, microphone, notifications, ...) denied. New windows and navigation blocked; only `https://github.com/` links open in the browser.
- Screen capture protection (macOS, Windows): the window appears black in screenshots and screen sharing.
- Electron fuses in packaged builds: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, app only loads from an integrity-checked `app.asar`, no extra `file://` privileges. Verified on a packaged Linux build (`--inspect` opens no port there, while the dev build does). Consequence: the Playwright end-to-end test runs against the unpackaged build.
- Packaged builds have no developer tools and a minimal menu (Edit, Window; plus the app menu on macOS).
- Single instance; the unlock screen slows down repeated wrong passwords and recovery keys (after 3 failures: 2, 4, 8 s ... up to 5 minutes).

## Clipboard and temporary files

- Copied values are cleared after 30 s, on lock and on quit, if the clipboard still holds them. Clipboard managers on the computer may still keep a copy; the app cannot prevent that.
- "Open" on an attachment writes a temporary decrypted copy (deleted on lock, quit and next start). Only document and image types can be opened this way; anything executable can only be saved.

## Cryptography

See [CRYPTO.md](CRYPTO.md). Known-answer tests pin X25519 (RFC 7748), XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha) and BLAKE2b (RFC 7693) to published vectors. libsodium's Argon2id API does not match the RFC 9106 test vector inputs (no secret, AD or parallelism), so it is tested for parameter sensitivity only.

## Not done / later

- No independent security audit.
- Touch ID / Windows Hello unlock: needs native platform code that cannot be tested from the build environment.
- Code signing (macOS notarization, Windows Authenticode): builds are unsigned, so users must trust the download source.
- Dependency audit: 0 known vulnerabilities in shipped packages. A moderate issue in `minimatch` affects build tooling only.
