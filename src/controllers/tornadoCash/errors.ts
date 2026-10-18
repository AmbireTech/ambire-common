import EmittableError from '../../classes/EmittableError'
import { describeTornadoCashAmounts } from '../../libs/tornadoCash/amounts'

/** A refusal the user can act on. `reason` is logged, never shown. */
const expectedError = (message: string, reason: string) =>
  new EmittableError({ message, level: 'expected', error: new Error(`tornadoCash: ${reason}`) })

/**
 * The errors Tornado Cash actions throw, in one place so what the user reads can be reviewed
 * together. Every message must make sense to someone who knows nothing about how it works.
 */
export const tornadoCashErrors = {
  // Availability of the selected account
  noAccountSelected: () =>
    expectedError('Please select a Tornado Cash account first.', 'no account selected'),
  unsupportedPlatform: () =>
    expectedError(
      'Tornado Cash is available only in the Ambire extension for Chrome.',
      'no plugin factory'
    ),
  unsupportedNetwork: () =>
    expectedError(
      'Tornado Cash needs the Ethereum network. Please add it back to use this account.',
      'no Ethereum provider'
    ),
  locked: () => expectedError('Please unlock your wallet to use Tornado Cash.', 'keystore locked'),

  // Deposits
  depositAccountRemoved: () =>
    expectedError('This Tornado Cash account is no longer in your wallet.', 'no account'),
  depositAmountNotSplittable: (assetAddress: string) =>
    expectedError(
      `Tornado Cash accepts only ${describeTornadoCashAmounts(assetAddress)}, or a sum of them.`,
      'amount is no sum of denominations'
    ),
  depositTooManyNotes: () =>
    expectedError(
      'This amount is split into too many parts to send at once. Please send a rounder amount, or send it in a few steps.',
      'too many notes'
    ),
  depositPending: () =>
    expectedError(
      'Your last send to this account is still on its way. Please wait a few minutes until it arrives and try again.',
      'a broadcast deposit is not mined yet'
    ),
  depositMisbuilt: (what: string) =>
    expectedError(
      'This send could not be prepared safely, so it was stopped. Please try again later.',
      `the SDK built an unexpected ${what}`
    ),

  // Accounts
  seedRemoved: (seedId: string) =>
    expectedError('This recovery phrase is no longer in your wallet.', `no stored seed ${seedId}`),
  accountExists: (seedId: string) =>
    expectedError(
      'This recovery phrase already has a Tornado Cash account.',
      `seed ${seedId} already has an account`
    )
}

/** What a failed sync shows on the dashboard. */
export const TORNADO_CASH_SYNC_FAILED_MESSAGE =
  'Your balance could not be loaded. Please try again in a moment.'
