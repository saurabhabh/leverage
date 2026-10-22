import { useState } from 'react'
import RecordSetup, { type RecordChoice } from './RecordSetup'

export default function Studio(): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  const record = async (choice: RecordChoice): Promise<void> => {
    setBusy(true)
    try {
      await window.leverage['capture:select'](choice.source.id)
    } finally {
      setBusy(false)
    }
  }

  return <RecordSetup busy={busy} onRecord={record} />
}
