import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/api'
import { api } from '../api'

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'none' })
  useEffect(() => {
    void api.getUpdateStatus().then(setStatus)
    return api.onUpdateStatus(setStatus)
  }, [])

  if (status.state === 'none' || status.state === 'downloading') return null
  return (
    <div className="update-banner" role="status">
      {status.state === 'available' && (
        <>
          ChurchVault {status.version} is available.
          <button onClick={() => void api.openUpdatePage()}>Download</button>
        </>
      )}
      {status.state === 'downloaded' && (
        <>
          ChurchVault {status.version} is ready to install.
          <button className="primary" onClick={() => void api.installUpdate()}>Restart and update</button>
        </>
      )}
    </div>
  )
}
