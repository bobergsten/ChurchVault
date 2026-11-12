# ChurchVault: installation and setup guide

ChurchVault keeps the church's passwords, card details, door codes and documents in one shared, encrypted vault. Everything is encrypted on your own computer before it is uploaded. The copy on GitHub can't be read without a member's password.

There are 3 to 4 members, and **every member is an admin**: anyone can approve or remove others.

---

## 1. Install the app

Download the newest version from the **Releases** page:
<https://github.com/bobergsten/ChurchVault/releases/latest>

| Your computer | File to download |
|---|---|
| Mac with Apple chip (M1, M2, M3, M4 ...) | `ChurchVault-<version>-mac-arm64.dmg` |
| Mac with Intel chip | `ChurchVault-<version>-mac-x64.dmg` |
| Windows 10 or 11 | `ChurchVault-<version>-win-x64.exe` |

Not sure which Mac you have? Apple menu → *About This Mac*. "Chip: Apple M…" means Apple chip; "Processor: Intel" means Intel.

The app is not yet signed with a paid Apple or Microsoft certificate, so your computer warns you the first time. This is expected.

### Mac

1. Open the `.dmg` and drag **ChurchVault** onto **Applications**.
2. Open ChurchVault from Applications. macOS says it can't verify the app. Click **Done** (not "Move to Trash").
3. Open **System Settings → Privacy & Security**. Scroll down to the message about ChurchVault and click **Open Anyway**, then confirm with your Mac password.
4. ChurchVault now opens normally from then on.

If macOS instead says the app "is damaged and can't be opened", open the **Terminal** app and run this once, then open the app again:

```
xattr -dr com.apple.quarantine /Applications/ChurchVault.app
```

### Windows

1. Run the downloaded `.exe`.
2. Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
3. Follow the installer. It installs for your user only and does not need administrator rights.

---

## 2. First-time setup (one person, once)

Only the **first** person does this. Everyone else follows section 3.

### 2a. Create a GitHub organization and a private vault repository

You need a free GitHub account (<https://github.com/signup>). Turn on two-factor authentication (Settings → Password and authentication); it protects the church's data.

**Why an organization:** each member signs in to GitHub with their **own** token, never a shared one. A fine-grained token, the safe kind that can be limited to the vault alone, only works for repositories owned by the token holder's own account or by an organization they belong to. Putting the vault in a free organization lets every member use such a token. It also means the vault doesn't belong to any one person.

1. On github.com click **+** → **New organization** → **Free**. Name it, for example, `your-church-vault`.
2. Under **People**, make sure at least **two** members will be organization **owners** (invite them now or later, see section 3). Then the church never depends on one person's account.
3. In the organization, click **+** → **New repository**. Owner: the organization. Name it, for example, `vault`.
4. Choose **Private**. This matters.
5. Do **not** add a README, .gitignore or license. Leave it empty.
6. Click **Create repository** and copy its address, e.g. `https://github.com/your-church-vault/vault`.

This repository is separate from the ChurchVault app itself. It only ever holds encrypted files.

**Vault already in your personal account?** Move it: repository → **Settings** → **Danger Zone** → **Transfer ownership** → the organization. Afterwards, on every computer that uses ChurchVault: header → **Disconnect**, then **Set up GitHub sync** with the new address and that member's token.

### 2b. Create an access token

The app uses a token, which works like a limited password, to upload and download the encrypted files. **Every member creates their own** and never shares it. When someone leaves, removing them from GitHub stops their token without affecting anyone else.

1. github.com → your picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name it `ChurchVault on <this computer>`. Set **Expiration** to the longest allowed, and put a reminder in your calendar for that date. When it runs out, the app shows a sync error with an **Update token** button (section 5).
3. **Resource owner**: choose the **organization**, not your own account. If the organization isn't listed, accept the invitation to join it first.
4. **Repository access**: *Only select repositories* → choose the vault repository.
5. **Permissions** → *Repository permissions* → **Contents: Read and write**. Nothing else is needed.
6. Click **Generate token** and copy it. GitHub shows it only once.

If GitHub says the token is **pending approval**, an organization owner approves it: organization → **Settings** → **Personal access tokens** → **Pending requests**. Owners can also turn the approval requirement off on that page.

**If the vault must stay in a personal account** (not recommended): other members can't create fine-grained tokens for it. They need a *classic* token instead: **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**, scope **`repo`**. A classic token can reach *every* private repository its owner has access to, not only the vault, so only use it if their GitHub accounts hold nothing else private.

### 2c. Create the vault

1. Open ChurchVault → **Create a new vault**.
2. Enter your name and a strong password (at least 10 characters). A short sentence works well, e.g. `blue organ plays on sunday`.
3. The app shows a **recovery key**. **Print it** and keep it somewhere safe and locked, such as the church office safe. It is shown only once. It can open the vault if everyone forgets their password, so treat it like the key to the safe.
4. Unlock with your password.
5. Click **Set up GitHub sync**, paste the repository address and the token, and click **Connect**.

The vault is ready. Add the first entries with **+ New**.

---

## 3. Adding another member

**The new person:**

1. Creates a GitHub account (with two-factor authentication) and tells you their GitHub user name.
2. Installs the app (section 1).

**An organization owner:**

3. On github.com open the organization → **People** → **Invite member** → their user name (role *Member*, or *Owner* if they should be able to invite others). Then open the vault repository → **Settings** → **Collaborators and teams** → **Add people** → their user name with the **Write** role. Tell them to accept the invitation (they get an e-mail).

**The new person:**

4. Creates their **own** token, as in 2b (resource owner: the organization; only the vault repository; Contents: Read and write).
5. Opens ChurchVault → **Join an existing vault**, enters their name, a password of their own, the repository address and their token, and clicks **Request access**.
6. The app shows a **security code** (for example `1FB7 E358 FD15 B1F3 49FE`).

**Both of you:**

7. The existing member opens **Members** in ChurchVault (after a moment, or after **Sync now**). The new person appears as *waiting for approval*, with a security code.
8. **Compare the codes by phone or in person**, not by e-mail or text message. They must match exactly. If they differ, someone may be trying to sneak in: do not approve.
9. Click **Approve**.
10. The new person clicks **Check if I have been approved** and unlocks with their own password.

---

## 4. Everyday use

- **Find** entries with the search box. It searches titles, tags, notes, websites, user names and file names, but never passwords or codes.
- **Copy** a password with *Copy*. It is wiped from the clipboard after 30 seconds and when the vault locks.
- **Lock** with the Lock button. The vault also locks by itself after 5 minutes without use, when the screen locks and when the computer sleeps.
- **Syncing** happens automatically (a few seconds after a change and every 5 minutes). The header shows when it last synced. Without internet you can keep working; changes upload later.
- **Files** (deeds, insurance policies, scans): create a *Document* entry and use *Add files…* (up to 25 MB each).
- **⚠ Conflict** on an entry means two people changed it at the same time. Both versions were kept. Open the one marked *Conflict*, compare it with the other entry of the same name, then choose *Use this version* or *Discard this version*.

---

## 5. When things change

### Someone leaves

1. Open **Members** → **Remove** next to their name and confirm.
2. The app changes the vault's key and shows a **new recovery key**. Print it and replace (shred) the old printout; the old key no longer works.
3. On github.com remove them from the organization (organization → **People** → their name → **Remove from organization**). This also stops their token.
4. Change the important passwords, cards and door codes they knew. The app cannot make someone forget what they have seen.

Do this when the others are not in the middle of editing.

### Forgotten password

On the unlock screen click **Forgot password?**, enter the printed recovery key and choose a new password. If the recovery key cannot be found, another member can remove you and invite you again (section 3).

### Change your password

**Members** → *Change my password*.

### The GitHub token expired

The header shows a sync error and an **Update token** button. Regenerate your token (Settings → Developer settings → Fine-grained tokens → the token → **Regenerate**), or create a new one as in 2b, and paste it.

### New computer for an existing member

Install the app, choose **Join an existing vault** with your name, and have another member approve you. You then appear twice in **Members** (once per computer). If you no longer use the old computer, remove that entry; this also changes the vault key, so print the new recovery key.

---

## 6. Updates

- **Windows:** new versions download in the background. A bar at the top says *Restart and update* when one is ready.
- **Mac:** a bar at the top says a new version is available. Click *Download*, then install it as in section 1. Your vault stays as it is.

---

## 7. Good practice

- Every member uses a strong, unique password for ChurchVault and two-factor authentication on GitHub.
- Keep the printed recovery key locked away, and know where it is.
- Lock the app (or your computer) when you walk away.
- Do not install ChurchVault on shared or public computers.
- The vault repository must stay **private**. GitHub still can't read the contents, but there is no reason to show even the encrypted files.
