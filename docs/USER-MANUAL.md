# ChurchVault User Manual

*[Svenska (Swedish version)](USER-MANUAL.sv.md)*

For everyday users of ChurchVault 0.1. The first-time installation and GitHub setup are in the [installation guide](INSTALL.md).

## About ChurchVault

ChurchVault is a shared, encrypted notebook for the church's secrets, used by three to four trusted people who are all administrators. It runs as an app on Mac and Windows computers.

It stores five kinds of entries:

- **Logins**: website, user name, password and an optional one-time-code secret.
- **Cards**: card holder, number, expiry, security code (CVV) and PIN.
- **Door codes**: location, code, who has it and when it was last changed.
- **Documents**: scans and files such as deeds or insurance policies, up to 25 MB each.
- **Notes**: free text.

Everything is locked with encryption on your own computer before it is saved or uploaded. The members' copies are kept in step through a private GitHub repository, but GitHub only ever holds scrambled data. Nobody without a member's password, including GitHub, can read the entries.

This manual is for everyday users. For first-time setup of GitHub and the installer, see the installation guide that comes with the app.

## Key ideas

Six words come up all the time. Knowing them makes the rest of the manual easy.

| Word | What it means |
| --- | --- |
| Vault | The collection of all the church's entries. There is one vault, shared by all members. |
| Member | A person with access. Every member has their own password and can approve or remove other members. |
| Password | Your personal password for ChurchVault, at least 10 characters. It is never stored anywhere and cannot be looked up. |
| Recovery key | A long printed code, shown once when the vault is created, that opens the vault if everyone forgets their password. |
| Security code | A short code like `1FB7 E358 FD15 B1F3 49FE` that identifies a person. You compare it by phone or in person before approving a new member. |
| GitHub token | A limited password that lets the app upload and download the encrypted files. Each member has their own. |

Two of these are worth remembering above all: **nobody can recover a lost password except with the recovery key**, and **the recovery key must be kept somewhere safe and locked**.

## Getting started

Install the app first (see the installation guide). When it opens for the first time, you choose one of two paths.

### The first person: create the vault

1. Click **Create a new vault**.
2. Enter your name and a password of at least 10 characters. A short sentence works well, for example `blue organ plays on sunday`.
3. The app shows your **recovery key**. Print it and store it in a locked place, such as the church office safe. It is shown only once. Tick the box to confirm and click **Continue**.
4. Unlock with your password.
5. Click **Set up GitHub sync** and follow the steps in the dialog so the other members can share the vault.

### Everyone else: join the vault

1. Click **Join an existing vault**.
2. Enter your name, a password of your own, the repository address and your own GitHub token. An existing member gives you the address.
3. Click **Request access**. The app shows a security code.
4. Read the security code to an existing member, by phone or in person. They approve you in the **Members** window.
5. Click **Check if I have been approved**. When it says you are approved, unlock with your password.

### Unlocking and locking

On the unlock screen choose your name from the list (it appears once the vault has several members), type your password and click **Unlock**. The version number is shown at the bottom.

Lock the vault with the **Lock** button in the top right. It also locks by itself after 5 minutes without use, when the screen locks and when the computer goes to sleep. Locked means nothing can be read until the password is entered again.

After three wrong passwords in a row the app makes you wait a little before the next try, and the wait grows with each failure.

## Working with entries

When the vault is open, the left column filters by type (**All**, **Logins**, **Cards**, **Door codes**, **Documents**, **Notes**), the middle column lists entries, and the right side shows the selected entry.

### Add an entry

1. Click **+ New** and choose the type.
2. Fill in the **Title** and the fields. Secret fields (passwords, card numbers, codes) are hidden while you type; click **Show** to check what you typed.
3. Optionally add notes, **tags** separated by commas, and tick **Favorite**. Favorites are listed first.
4. Click **Save**.

### Read, copy, edit and delete

- Click an entry in the list to see it. Secret values show as dots. Click **Show** to reveal one; it hides itself again after 20 seconds.
- Click **Copy** to put a value on the clipboard. The app clears the clipboard after 30 seconds, and when the vault locks, if it still holds what you copied.
- Click **Edit** to change an entry, or **Delete** to remove it. Deleting asks you to confirm.

### Search

Type in the **Search** box at the top. It finds words in titles, tags, notes, website addresses, user names, locations, holder names and file names. Several words must all match, and the start of a word is enough. Capital letters and accents do not matter.

Search never looks inside passwords, card numbers, security codes, PINs or door codes, so you cannot find an entry by its secret.

### Password generator

When you add or edit a login, click **Generate** next to the password. Choose a length from 8 to 64 characters and which kinds of characters to use (lowercase, uppercase, digits, symbols). **No look-alikes** leaves out characters such as 0 and O or 1 and l. Click **Regenerate** for a new one, then **Use this** to put it in the entry. Longer is stronger; 20 characters or more is a good habit.

## Documents and attachments

Any entry can carry files, such as scans of a deed, an insurance policy or a contract. The **Documents** type is meant for entries that are mostly files.

### Add files

1. Open or create an entry and click **Add files…** in the form.
2. Choose one or more files in the window that opens. Each file may be at most 25 MB, and an entry can hold up to 20 files.
3. Click **Save**. Files that you added but did not save are discarded when the vault locks.

Attachments cannot be renamed in this version. To change a name, click **Remove** next to the file, then add the file again under its new name.

### Use files

Open the entry and use the buttons next to each file:

| Button | What it does |
| --- | --- |
| Preview | Shows pictures (PNG, JPEG, GIF, WebP) and plain text files inside the app. |
| Open | Opens the file in your usual program, such as a PDF reader. The app makes a temporary readable copy, which it deletes when the vault locks or the app closes. Only documents and pictures can be opened this way. |
| Save a copy… | Saves a readable copy where you choose. Use this for any file type that Open refuses. |

A readable copy outside ChurchVault is no longer protected. Delete saved copies when you are done with them.

If a file shows as missing on a new computer, it has probably not finished syncing. Click **Sync now** and try again.

## Syncing with GitHub

Syncing keeps every member's computer up to date. Your changes are saved on your computer at once, and uploaded when you are online.

The app syncs by itself when you unlock, a few seconds after each change, and every 5 minutes. The top bar shows when it last synced. Click **Sync now** to sync immediately. You can work without internet; changes are uploaded later.

If something is wrong, the top bar shows a short message instead of the time:

- **GitHub rejected the access token**: your token has expired or was removed. Click **Update token**, create a new token and paste it. The old one is kept if the new one does not work.
- **Cannot reach GitHub (offline?)**: check your internet connection. Nothing is lost.

**Disconnect** stops syncing on this computer. Your entries stay on the computer and on GitHub.

### When two people edit the same entry

If two people change the same entry before their computers have synced, nothing is lost. The version that was saved to GitHub first stays as the entry. The other version is kept as a separate entry with the same title and a red **⚠ Conflict** label.

To resolve it:

1. Open the entry marked **⚠ Conflict**. A banner explains what happened.
2. Compare it with the other entry of the same name.
3. Click **Use this version** to replace the original with this one, or **Discard this version** to delete it.

If one person deletes an entry while another edits it, the edit wins and the entry stays.

## Managing members

Click **Members** in the top bar. Every member can do everything in this window.

### Add a new member

1. The new person installs the app and chooses **Join an existing vault** (see Getting started).
2. Someone with GitHub administrator rights invites them to the church's GitHub organization and gives them write access to the vault repository. The installation guide explains how.
3. After a moment, or after **Sync now**, the new person appears in **Members** as *waiting for approval*, with a security code.
4. Compare that code with the one on the new person's screen, by phone or in person, never by e-mail or text message. It must match exactly. If it does not, do not approve.
5. Click **Approve**.

To refuse a request, click **Decline**. That removes it and changes nothing else.

### Remove a member

1. Click **Remove** next to the name and confirm.
2. The app changes the vault's encryption key, so the removed person cannot read anything new. It shows a **new recovery key**. Print it, store it safely and destroy the old printout, because the old key no longer works.
3. Remove the person from the church's GitHub organization.
4. Change the important passwords, cards and door codes they knew. The app cannot make someone forget what they have already seen.

Do this when nobody else is editing. A change saved on another computer at the very same moment may become unreadable.

### Your own password

- **Change it:** in **Members**, under *Change my password*, enter the old and new password.
- **Forgot it:** on the unlock screen click **Forgot password?**, choose your name, enter the printed recovery key and choose a new password. Your entries are not affected.
- **Lost the recovery key too:** another member can remove you and invite you again, but you cannot get back in alone.

### A warning next to a name

If a member shows **⚠ could not be verified**, their record was changed by someone who does not have access to the vault. Do not approve or trust it. Remove that member and invite them again, and ask another member to look at the GitHub repository.

## Safety tips and limits

The app protects the entries well, but your habits matter as much as the software.

### Good habits

- Use a strong, unique password for ChurchVault, and turn on two-factor authentication on every member's GitHub account.
- Keep the printed recovery key locked away, and make sure at least two members know where it is.
- Lock the app, or the computer, when you step away.
- Install ChurchVault only on your own computers, never on shared or public ones.
- Copy a password only when you need it. Do not paste secrets into e-mail or chat.
- Keep the vault repository on GitHub **private**.
- When someone leaves, follow the steps under Remove a member and change the secrets they knew.

### What GitHub and others can see

Everything you type into an entry is encrypted: titles, passwords, card details, codes, notes, tags, file names and file contents. Someone who gets the repository, or the files on a stolen computer, sees only scrambled data.

Some information is **not** hidden:

- The **names of the members** are stored readable, both in each member's record and as the author of every change in GitHub's history.
- How many entries and files exist, roughly how large they are, and when they changed.
- Which GitHub accounts have access to the repository.

These details do not give access to any secret. If that is a problem for your church, tell the person who maintains the app; hiding the names is possible but has not been built yet.

### What the app cannot do

- It cannot recover a lost password without the recovery key.
- It cannot protect a computer that already has a virus or a stranger controlling it.
- It cannot take back what a former member has already seen or copied.
- A decrypted copy that you save or open outside the app is no longer protected.
- The app is not signed by Apple or Microsoft, which is why your computer warns you the first time you open it.

## Troubleshooting and questions

| Problem | What to do |
| --- | --- |
| "Wrong password" | Check the keyboard layout and Caps Lock. After several failures the app makes you wait before you can try again. |
| I forgot my password | Click **Forgot password?** on the unlock screen and use the printed recovery key. |
| I lost the recovery key and my password | Ask another member to remove you and invite you again. |
| "Refusing to unlock …" | The app found that someone tampered with the vault files on GitHub. Do not keep trying. Ask another member to check the repository's history on GitHub. |
| The top bar shows a sync error | Read the message. Token problems: click **Update token**. Offline: wait for the connection. Otherwise click **Sync now**. |
| A file says it is missing | It has not synced to this computer yet. Click **Sync now** and try again. |
| The new member does not show up in Members | They need to have clicked **Request access** and you may need to click **Sync now**. They must also be invited on GitHub. |
| Some entries "could not be read" after unlocking | The vault key was changed by another member. Click **Sync now**, lock and unlock again. If it persists, ask the person who removed a member whether the change finished. |
| An entry has a **⚠ Conflict** label | Two people edited it at once. See "When two people edit the same entry" above. |
| The window looks wrong or is empty | Close the app completely and start it again. Your data is not affected. |

### Updates

On Windows, new versions download in the background. A bar at the top shows **Restart and update** when one is ready; the vault locks when you click it.

On Mac, a bar at the top tells you a new version exists. Click **Download**, then install it the way you installed the first one. Your vault stays as it is.

### Where is my data?

Entries are kept as encrypted files on your computer and in the private GitHub repository. Uninstalling the app does not delete your local copy. To remove a computer from the vault, remove its member in **Members** and then delete the app's data folder.

### Getting help

If something goes wrong that is not listed here, write down the message you see and what you did just before, and send it to the person who maintains the app. Never send passwords or the recovery key.
