import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: {}, clipboard: {}, dialog: {}, ipcMain: {}, shell: {} }))
const { isOpenable } = await import('./ipc')
const { safeFileName } = await import('./attachments')

describe('"Open" allowlist', () => {
  it('allows documents and images', () => {
    for (const n of ['a.pdf', 'Deed.PDF', 'photo.jpeg', 'budget.xlsx', 'notes.txt', 'plan.docx']) expect(isOpenable(n)).toBe(true)
  })
  it('refuses anything the system might run', () => {
    for (const n of ['invoice.pdf.exe', 'x.bat', 'x.cmd', 'x.ps1', 'x.vbs', 'x.js', 'x.lnk', 'x.app', 'x.command', 'x.sh', 'x.jar', 'x.msi', 'x.scr', 'x.hta', 'x.html', 'x.svg', 'noext', 'x.pdf.']) {
      expect(isOpenable(safeFileName(n))).toBe(n === 'x.pdf.') // trailing dot is stripped by safeFileName
    }
  })
})

describe('safeFileName', () => {
  it('strips paths, reserved characters and names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFileName('a<b>:c"d|e?f*g.txt')).toBe('a_b__c_d_e_f_g.txt')
    expect(safeFileName('CON.txt')).toBe('_CON.txt')
    expect(safeFileName('...')).toBe('attachment')
  })
})
