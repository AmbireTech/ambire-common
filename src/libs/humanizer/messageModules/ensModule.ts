import { HumanizerTypedMessageFunction } from '../interfaces'
import { ExpectedTypedData, getAction, getDeadline, getLabel, isExactTypedData } from '../utils'

/** ENS profile picture or header upload, as the ENS app signs it */
const ENS_UPLOAD_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'Upload',
  types: {
    Upload: [
      { name: 'upload', type: 'string' },
      { name: 'expiry', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'hash', type: 'string' }
    ]
  }
}

/** Humanizes an ENS profile picture upload (primary type `Upload`) */
export const humanizeEnsUpload: HumanizerTypedMessageFunction = (message) => {
  if (
    message.content.domain.name === 'Ethereum Name Service' &&
    isExactTypedData(message.content, ENS_UPLOAD_TYPED_DATA)
  ) {
    if (
      message.content.message.upload === 'avatar' &&
      message.content.message.name &&
      message.content.message.expiry
    )
      return {
        fullVisualization: [
          getAction('Update'),
          getLabel('ENS profile pic of'),
          getLabel(message.content.message.name),
          getDeadline(BigInt(message.content.message.expiry) / 1000n)
        ]
      }
  }
  return null
}
