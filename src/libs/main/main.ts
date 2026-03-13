import { Account } from '../../interfaces/account'

export const ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST'

/**
 * Whether to simulate account ops if the request window is closed or the current
 * request is different.
 */
export const getShouldSimulateInTheBackground = (account: Account) => {
  // Only if it IS NOT a safe account
  return !account.safeCreation
}
