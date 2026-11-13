import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../../userOperation/userOperation'
import { HumanizerTypedMessageFunction } from '../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../utils'

/**
 * Humanizes the old entry point authorization (primary type `AmbireOperation`).
 * The wallet no longer asks for it, but it can still be in the signed message history.
 */
export const humanizeEntryPointAuthorization: HumanizerTypedMessageFunction = (message) => {
  if (message.fromRequestId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID)
    return {
      fullVisualization: [
        getAction('Authorize entry point'),
        getLabel('for'),
        getAddressVisualization(message.accountAddr)
      ]
    }
  return null
}
