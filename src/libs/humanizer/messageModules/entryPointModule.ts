import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../../userOperation/userOperation'
import { HumanizerTypedMessageFunction } from '../interfaces'
import {
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getLabel,
  isExactTypedData
} from '../utils'

/** The entry point authorization, as the wallet built it (`getTypedData` in `libs/signMessage`) */
const AMBIRE_OPERATION_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'AmbireOperation',
  types: {
    AmbireOperation: [
      { name: 'account', type: 'address' },
      { name: 'hash', type: 'bytes32' }
    ]
  }
}

/**
 * Humanizes the old entry point authorization (primary type `AmbireOperation`).
 * The wallet no longer asks for it, but it can still be in the signed message history.
 */
export const humanizeEntryPointAuthorization: HumanizerTypedMessageFunction = (message) => {
  if (
    message.fromRequestId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
    isExactTypedData(message.content, AMBIRE_OPERATION_TYPED_DATA)
  )
    return {
      fullVisualization: [
        getAction('Authorize entry point'),
        getLabel('for'),
        getAddressVisualization(message.accountAddr)
      ]
    }
  return null
}
