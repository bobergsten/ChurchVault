# Members

Everyone is an admin: any member can approve or remove others.

**Joining** (new person, new computer): "Join an existing vault" asks for name, a password of their own, the repository address and their own GitHub token (they must first be added as a collaborator on GitHub). The app clones the repo, creates the person's keypair, uploads `members/<id>.json` *without* access, and shows a **security code** (fingerprint of their public key).

**Approving:** an existing member opens *Members*, sees the waiting person with the same code, confirms by phone or in person that the codes match (this defeats someone swapping in their own key), and presses Approve. The vault key is sealed to the new public key and synced. The new person presses "Check if I have been approved", then unlocks with their own password.

**Declining** a request just deletes it; the key stays the same.

**Removing a member** (with access) changes the vault key:
1. sync first and make a clean commit;
2. re-encrypt every entry and attachment under a new key (if any cannot be read, abort with nothing changed);
3. write entries, the remaining members' sealed keys and the new `vault.json`, delete the removed member; on failure, reset the working tree to the last commit;
4. switch this computer to the new key (the local index is rebuilt, since its key derives from the vault key) and push at once;
5. show a **new recovery key**; the old one no longer works.

Other computers notice the higher key generation on their next sync and lock; they unlock again with the new sealed key. The removed person's member file is gone, and they must also be removed as a GitHub collaborator.

What removal cannot do: the removed person may have copied secrets they could already read, and Git history still holds old ciphertext they had access to. The dialog tells the admin to change the important passwords. Do removals while other members are idle: an entry saved on another computer under the old key at the same moment cannot be read after the change (it is reported as unreadable).

**Forgotten password:** "Forgot password?" on the unlock screen. The printed recovery key opens the vault, and the member gets a fresh keypair and new password (same id and name, so entries still show who edited them). Anyone holding the recovery key can do this for any member, so keep it in a safe place. Another option is that a different member simply removes and re-invites the person.

**Changing a password** only re-wraps the member's own secret key; entries are untouched.
