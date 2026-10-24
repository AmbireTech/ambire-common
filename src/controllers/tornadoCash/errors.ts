import EmittableError from '../../classes/EmittableError'
import { describeTornadoCashAmounts } from '../../libs/tornadoCash/amounts'

/** An unexpected failure, keeping what caused it. `reason` stands in when that is not an `Error`. */
const majorError = (message: string, cause: unknown, reason: string) =>
  new EmittableError({
    message,
    level: 'major',
    error: cause instanceof Error ? cause : new Error(`tornadoCash: ${reason}`)
  })

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

  // Withdrawals
  withdrawalInProgress: () =>
    expectedError(
      'Another send from this account is in progress. Please wait until it finishes.',
      'an operation is in flight'
    ),
  withdrawalInvalidRecipient: () =>
    expectedError('Please enter a valid recipient address.', 'invalid recipient'),
  withdrawalAmountNotSendable: () =>
    expectedError(
      'Tornado Cash can send only whole parts of your balance. Please pick an amount your parts add up to.',
      'amount is no sum of owned notes'
    ),
  withdrawalNotPrepared: (cause?: unknown) =>
    majorError(
      'This send could not be prepared. Please try again in a moment.',
      cause,
      'the withdrawal could not be prepared'
    ),
  withdrawalNotReady: () => expectedError('Please prepare the send again.', 'no withdrawal ready'),
  withdrawalNotSent: (cause?: unknown) =>
    majorError(
      'This send could not be submitted. Please try again in a moment.',
      cause,
      'the withdrawal could not be broadcast'
    ),
  withdrawalReverted: () =>
    expectedError(
      'This send did not go through. Your funds are still in your account. Please try again.',
      'the withdrawal reverted'
    ),
  withdrawalNotConfirmed: () =>
    expectedError(
      'This send is taking longer than usual. Refresh your balance in a few minutes to see if it went through.',
      'no receipt in time'
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
