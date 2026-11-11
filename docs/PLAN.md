# ChurchVault: Plan

A desktop app (macOS and Windows) for a church, where 3-4 trusted people share a vault of secret entries: website logins, credit cards, door/key codes and secret documents. Data is encrypted end to end and synced through a private GitHub repository.

## 1. Goals and non-goals

**Goals**
- Store logins, credit cards, door/access codes, secure notes and secret documents.
- Encrypted at rest locally (SQLite) and in Git. GitHub never sees plaintext.
- 3-4 members share one vault, each with their own password.
- Works offline. Syncs through Git when online.
- Installable on macOS and Windows (unsigned builds are fine for now).

**Non-goals (v1)**
- Mobile apps, browser autofill, public sharing links.
- Per-entry permissions (see "Later: collections").
- A server of our own. GitHub is the only backend.

## 2. Architecture

Committing a single encrypted `.db` file to Git does not work: every edit rewrites the whole binary file, merges are impossible, and two people editing at once cause an unresolvable conflict. So:

| Layer | What it is | Role |
|---|---|---|
| **Git repo** (private, GitHub) | One encrypted file per entry, encrypted attachment blobs, and member key files | Source of truth and sync |
| **Local SQLite** (SQLCipher) | Decrypted index of all entries | Local cache for fast search, encrypted at rest |

After a pull, the app decrypts changed files into SQLite. Editing an entry re-encrypts that one file and commits it. Conflicts only occur when two people edit the same entry.

### Repo layout
```
vault.json                 # format version, KDF/cipher params
members/<memberId>.json    # public key, display name, role, vault key sealed to that member, private key wrapped by the member's password
entries/<uuid>.vault       # one encrypted entry each (UUID names: no titles leak)
blobs/<uuid>.bin           # encrypted attachments (chunked)
```

## 3. Tech stack

- **Electron + Node**, TypeScript, React + Vite (`electron-vite`).
- **SQLite:** `better-sqlite3-multiple-ciphers` (SQLCipher-compatible).
- **Crypto:** `libsodium-wrappers` (Argon2id, X25519 sealed boxes, XChaCha20-Poly1305).
- **Git:** `isomorphic-git` (pure JS). Decision: it needs no Git install on Windows and behaves identically on both platforms. Fall back to system `git` only if performance with large attachments proves poor.
- **GitHub auth:** OAuth Device Flow (fallback: fine-grained PAT limited to the one repo). Token stored with Electron `safeStorage` (Keychain / DPAPI).
- **Packaging:** `electron-builder` (`.dmg`, NSIS `.exe`), auto-update via GitHub Releases. Unsigned for now; users accept the OS warning on first launch.
- **Testing:** Vitest for crypto/storage/sync, Playwright for UI, GitHub Actions CI on macOS and Windows.

## 4. Crypto and multi-user model

1. **Vault key:** random 256-bit key, generated once. It encrypts every entry and blob, and derives the SQLite key.
2. **Each member has a keypair** (X25519). The private key is wrapped with a key derived from that member's password (Argon2id). Passwords are never shared and never leave the device.
3. **Vault key sealed per member:** the vault key is encrypted to each member's public key and stored in their `members/<id>.json`.
4. **Adding a member (admin):** the admin enters the new member's public key (the new member generates it on first launch and sends it over), seals the vault key to it, commits the file, and adds the person's GitHub account as a repo collaborator.
5. **Removing a member (admin):** revoke GitHub access, then **rotate the vault key**: generate a new key, re-encrypt all entries and blobs, re-seal to the remaining members. Caveat: a removed member may have kept old copies, so the actual secrets they knew (passwords, codes) should also be changed. The app shows a checklist for this.
6. **Changing your password** only rewraps your private key; no re-encryption.
7. **Recovery:** at setup an admin prints a recovery key that can unlock the vault. Since everyone is an admin, any other member can re-add someone who lost their password. Losing all passwords and the recovery key means losing the data.
8. **Roles:** every member is an admin (read/write entries, add/remove members, rotate keys). Because any member can remove another, member removal asks for confirmation. A read-only role is possible later.
9. **Audit:** Git history shows who changed what and when (commit author = member). Commits are not cryptographically signed in v1.

## 5. Data model

Common fields: `id`, `type`, `title`, `tags`, `favorite`, `notes`, `attachments[]`, `createdAt`, `updatedAt`, `updatedBy`, `rev`.

- **Login:** URL, username, password, TOTP secret, password history.
- **Credit card:** holder, number, expiry, CVV, PIN, billing address.
- **Door / access code:** location, code, who has it, last changed.
- **Secret document:** encrypted file attachments (PDF, images) plus notes.
- **Secure note:** free text.

## 6. Sync and conflicts

- Sync cycle: commit local changes, pull (rebase), push. Runs on launch, on a timer, and on demand.
- Per-entry files mean most concurrent edits merge cleanly.
- If the same entry changed on two devices, keep both versions and show a conflict screen. Nothing is silently overwritten.
- Git history gives per-entry version history and restore.
- Deleted secrets remain in history as ciphertext (protected by key rotation if a member leaves).
- Attachment size limit (e.g. 25 MB) to stay clear of GitHub's 100 MB limit and keep clones fast.

## 7. Security hardening

- Electron: `contextIsolation: true`, `nodeIntegration: false`, strict CSP, a narrow preload IPC API. Crypto and Git run in the main process only.
- Vault key held in memory only. Auto-lock on inactivity and on system sleep/lock.
- Clipboard cleared 20-30 s after copy. Secret fields masked by default. Screen capture protection (`setContentProtection`).
- No secrets in logs or crash reports.
- Optional biometric unlock (Touch ID / Windows Hello) later.
- Milestone 8 review findings and fixes: see [SECURITY.md](SECURITY.md).
- Known leak: commit times and file counts are visible to GitHub. Acceptable for this use.
- GitHub accounts of all members should have 2FA enabled (documented in setup guide).

## 8. Milestones

1. **Scaffold:** electron-vite + TypeScript, lint, tests, CI building on macOS and Windows.
2. **Crypto core:** vault create/unlock, member keypairs, entry encrypt/decrypt, known-answer tests.
3. **Storage:** SQLCipher index, entry repository, rebuild index from repo files.
4. **UI v1:** unlock screen, entry list and search, forms per entry type, password generator.
5. **Git sync:** GitHub login, init/clone, commit/pull/push, conflict screen.
6. **Members:** add/remove member flow, key rotation, recovery key.
7. **Attachments:** encrypted documents, viewer, size limits.
8. **Hardening:** auto-lock, clipboard clearing, security review, threat-model pass.
9. **Packaging:** unsigned `.dmg` and `.exe`, auto-update, install guide for the church.

## 9. Later

- **Collections** with separate keys (e.g. "Finance" visible only to the treasurer).
- CSV import from other password managers; export for backup.
- Commit signing, read-only role, biometric unlock, breach check.
- Mobile read-only viewer.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Everyone forgets passwords / no recovery key | Mandatory recovery key at setup; two admins |
| Member leaves with copies of old data | Key rotation plus checklist to change the actual secrets |
| Unsigned builds trigger OS warnings | Document first-run steps; add signing later |
| Native module (SQLCipher) builds per platform | `electron-rebuild` in CI for both OSes |
| Merge conflicts on shared entries | Keep-both conflict UI, per-entry files |
| Repo accidentally made public | Setup check that the repo is private; ciphertext only regardless |

## 11. Decisions

- All 3-4 members are admins.
- One shared vault for v1; collections with separate keys stay in "Later".
