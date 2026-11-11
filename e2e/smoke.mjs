// End-to-end check of the real app: create vault, add entries, search, lock, unlock.
// Usage: npm run build && npm run e2e   (on Linux without a display: xvfb-run -a npm run e2e)
import { _electron as electron } from 'playwright'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const userData = mkdtempSync(join(tmpdir(), 'cv-e2e-'))
const launch = () =>
  electron.launch({
    args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, CHURCHVAULT_USER_DATA: userData }
  })

let app = await launch()
try {
  let page = await app.firstWindow()

  // First run: create vault
  await page.getByRole('button', { name: 'Create a new vault' }).click()
  await page.getByLabel('Your name').fill('Anna')
  await page.getByLabel(/^Password/).fill('correct horse battery')
  await page.getByLabel('Repeat password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Create vault' }).click()
  const recovery = await page.getByTestId('recovery-key').innerText()
  assert.match(recovery, /^[A-Z2-7]{5}(-[A-Z2-7]{1,5})+$/)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Unlock (wrong, then right)
  await page.getByLabel('Password').fill('wrong password')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('alert').filter({ hasText: 'Wrong password' }).waitFor()
  await page.getByLabel('Password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('button', { name: 'Lock' }).waitFor()

  // Add a login with a generated password
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByRole('button', { name: /Logins/ }).last().click()
  await page.getByLabel('Title').fill('Church bank')
  await page.getByLabel('Website').fill('https://bank.example')
  await page.getByLabel('Username').fill('treasurer')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.getByRole('button', { name: 'Use this' }).click()
  const generated = await page.getByLabel('Password', { exact: true }).inputValue()
  assert.ok(generated.length >= 20)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('heading', { name: 'Church bank' }).waitFor()

  // Add a door code
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByRole('button', { name: /Door codes/ }).last().click()
  await page.getByLabel('Title').fill('Side door')
  await page.getByLabel('Location').fill('North entrance')
  await page.getByLabel('Code', { exact: true }).fill('4711#')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('heading', { name: 'Side door' }).waitFor()
  // secret is masked until revealed
  assert.equal(await page.getByText('4711#').count(), 0)
  await page.getByRole('button', { name: 'Show' }).click()
  await page.getByText('4711#').waitFor()

  // Document with an attachment: the system dialogs are stubbed in the main process
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const pngPath = join(userData, 'floorplan.png')
  const savedPath = join(userData, 'saved-copy.png')
  writeFileSync(pngPath, png)
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.open] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.save })
  }, { open: pngPath, save: savedPath })
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByRole('button', { name: /Documents/ }).last().click()
  await page.getByLabel('Title').fill('Church floor plan')
  await page.getByRole('button', { name: 'Add files…' }).click()
  await page.getByText('floorplan.png').waitFor()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: 'Church floor plan' }).waitFor()
  await page.getByRole('button', { name: 'Preview' }).click()
  await page.getByRole('dialog', { name: 'Preview of floorplan.png' }).getByRole('img').waitFor()
  await page.getByRole('dialog', { name: 'Preview of floorplan.png' }).getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Save a copy…' }).click()
  await page.waitForTimeout(500)
  assert.ok(readFileSync(savedPath).equals(png), 'saved copy matches the original')

  // Search: by title yes, by secret no
  await page.getByLabel('Search').fill('bank')
  await page.locator('.list li').filter({ hasText: 'Church bank' }).waitFor()
  assert.equal(await page.locator('.list li').count(), 1)
  await page.getByLabel('Search').fill('4711')
  await page.getByText('No matches.').waitFor()
  await page.getByLabel('Search').fill('')

  // Members dialog lists me; change password
  await page.getByRole('button', { name: 'Members' }).click()
  await page.getByRole('dialog', { name: 'Members' }).getByText('Anna').waitFor()
  await page.getByLabel('Current password').fill('correct horse battery')
  await page.getByLabel('New password').fill('a brand new password')
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByText('Password changed.').waitFor()
  await page.getByRole('button', { name: 'Close' }).click()

  // GitHub sync dialog validates the address (no network involved)
  await page.getByRole('button', { name: 'Set up GitHub sync' }).click()
  await page.getByLabel('Repository address').fill('https://example.com/x/y')
  await page.getByLabel('Access token').fill('ghp_dummy')
  await page.getByRole('button', { name: 'Connect' }).click()
  await page.getByRole('alert').filter({ hasText: 'repository address' }).waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Lock, forget the password, recover with the recovery key
  await page.getByRole('button', { name: 'Lock' }).click()
  await page.getByRole('button', { name: 'Unlock' }).waitFor()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Recovery key').fill(recovery.toLowerCase().replaceAll('-', ' '))
  await page.getByLabel('New password (at least 10 characters)').fill('recovered password 1')
  await page.getByLabel('Repeat new password').fill('recovered password 1')
  await page.getByRole('button', { name: 'Reset password and unlock' }).click()
  await page.getByRole('button', { name: 'Lock' }).waitFor()

  // Lock, restart the app, data persists
  await page.getByRole('button', { name: 'Lock' }).click()
  await page.getByRole('button', { name: 'Unlock' }).waitFor()
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.getByLabel('Password').fill('recovered password 1')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.locator('.list li').filter({ hasText: 'Church bank' }).waitFor()
  assert.equal(await page.locator('.list li').count(), 3)
  await page.screenshot({ path: process.env.E2E_SCREENSHOT ?? join(userData, 'shot.png') })
  console.log('e2e OK')
} finally {
  await app.close().catch(() => {})
  rmSync(userData, { recursive: true, force: true })
}
