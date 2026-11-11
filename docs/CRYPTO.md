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
