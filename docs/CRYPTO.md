# Crypto design (implemented in `src/main/crypto`)

| Purpose | Primitive (libsodium) |
|---|---|
| Password to key | Argon2id (`crypto_pwhash`, MODERATE: 3 passes, 256 MiB), per-member random salt, password NFKC-normalised |
| Encrypt entries, wrapped keys, recovery | XChaCha20-Poly1305, random 192-bit nonce per message |
| Give a member the vault key | X25519 sealed box (`crypto_box_seal`) |
| Local SQLite key | `crypto_kdf_derive_from_key(ctx="sqlitedb")` from the vault key |
| Recovery key checksum | BLAKE2b, 2 bytes |

**Key hierarchy:** vault key (random 256 bit) -> sealed to each member's public key. Each member's secret key is encrypted with their password-derived key. The recovery key (random 256 bit, printed once) encrypts a second copy of the vault key.

**AAD binding:** every ciphertext is authenticated against its context (`vaultId`, entry id, key generation, member id). Renaming or swapping files, or moving a wrapped key to another member, fails to decrypt.

**Rotation:** `rotateVaultKey` makes a new vault key and bumps `generation`; the caller re-encrypts entries with `rekeyEntry`. A removed member keeps whatever they could already read, so the real secrets must also be changed.

**Not yet covered:** attachment (chunked) encryption (milestone 7), commit signing, biometric unlock. Only tested against round-trip/tamper cases; there is no external audit, so treat as unreviewed until the milestone 8 security pass.

## Storage (milestone 3, `src/main/storage`)

- `FileStore`: the Git working tree (`vault.json`, `members/`, `entries/`). Atomic writes; entry ids must be UUIDs, so a hostile file name cannot escape the folder.
- `IndexDb`: SQLCipher database (key from `VaultSession.sqliteKey()`), with an FTS5 search table. Secret fields (passwords, card number/CVV/PIN, door codes, TOTP) are never put in the search table. User search text is turned into quoted prefix terms, so FTS operators are not interpreted.
- `EntryRepository`: create/update/delete/list/search. `rebuild()` brings the index in line with the files after a pull and reports files that fail to decrypt instead of aborting.
- Native module note: `npm test` runs against Node's ABI. Packaging (`npm run dist`) rebuilds `better-sqlite3-multiple-ciphers` for Electron, so run `npm rebuild` afterwards before running tests again.
