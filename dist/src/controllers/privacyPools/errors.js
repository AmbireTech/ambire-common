"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.privacyPoolsErrors = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
/** A refusal the user can act on. `reason` is logged, never shown. */
const expectedError = (message, reason) => new EmittableError_1.default({ message, level: 'expected', error: new Error(`privacyPools: ${reason}`) });
/** An unexpected failure, keeping what caused it. `reason` stands in when that is not an `Error`. */
const majorError = (message, cause, reason) => new EmittableError_1.default({
    message,
    level: 'major',
    error: cause instanceof Error ? cause : new Error(`privacyPools: ${reason}`)
});
/**
 * The errors Privacy Pools actions throw, in one place so what the user reads can be reviewed
 * together. Every message must make sense to someone who knows nothing about how it works.
 */
exports.privacyPoolsErrors = {
    // Availability of the selected account
    noAccountSelected: () => expectedError('Please select a Privacy Pools account first.', 'no Privacy Pools account selected'),
    noSupportedNetwork: () => expectedError('Privacy Pools is not available on any of the networks you have added.', 'no supported network'),
    locked: () => expectedError('Please unlock your wallet to use Privacy Pools.', 'keystore locked'),
    unavailableForAccount: () => expectedError('Privacy Pools is not available for this account.', 'no seed id'),
    // Accounts
    seedRemoved: (seedId) => expectedError('This recovery phrase is no longer in your wallet.', `no stored seed ${seedId}`),
    accountExists: (seedId) => expectedError('This recovery phrase already has a Privacy Pools account.', `seed ${seedId} already has an account`),
    // Deposits
    depositAccountRemoved: (seedId) => expectedError('This Privacy Pools account is no longer in your wallet.', `no account for seed ${seedId}`),
    depositLocked: () => expectedError('Please unlock your wallet to send to a Privacy Pools account.', 'keystore locked'),
    depositUnsupportedNetwork: (chainId) => expectedError('Privacy Pools accounts cannot receive funds on this network.', `unsupported chain ${chainId}`),
    depositUnsupportedToken: (tokenAddress, chainId) => expectedError('This token cannot be sent to a Privacy Pools account.', `unsupported asset ${tokenAddress} on chain ${chainId}`),
    depositAboveMaximum: (maxDeposit, { decimals, symbol }) => expectedError(`A Privacy Pools account accepts at most ${(0, ethers_1.formatUnits)(maxDeposit, decimals)} ${symbol} at a time.`, 'deposit above the operator ceiling'),
    depositBelowMinimum: (minimumDeposit, { decimals, symbol }) => expectedError(`A Privacy Pools account accepts at least ${(0, ethers_1.formatUnits)(minimumDeposit, decimals)} ${symbol} at a time.`, 'deposit below the entrypoint minimum'),
    depositUnsupportedPool: (symbol, poolAddress) => expectedError(`Sending ${symbol} to a Privacy Pools account is not supported yet.`, `no paymaster adapter for pool ${poolAddress}`),
    depositAwaitingChain: () => expectedError('Your previous transfer to this Privacy Pools account is still being confirmed. Please try again once it is.', 'the next precommitment is still in a pending deposit'),
    depositAssetConfigReadFailed: (cause) => majorError('Could not check what Privacy Pools accepts for this token. Please try again.', cause, 'asset config read failed'),
    depositPreparationFailed: (cause) => majorError('Could not prepare the transfer to this Privacy Pools account. Please try again.', cause, 'deposit preparation failed'),
    // Withdrawals
    withdrawalUnsupportedNetwork: (chainId) => expectedError('Sending from a Privacy Pools account is not available on this network yet.', `no paymaster configured for chain ${chainId}`),
    withdrawalUnsupportedToken: (symbol, poolAddress) => expectedError(`Sending ${symbol} from a Privacy Pools account is not supported yet.`, `no paymaster adapter for pool ${poolAddress}`),
    withdrawalBundlerOptedOut: () => expectedError('Sending from a Privacy Pools account needs "ERC-4337 smart account features", which you turned off. Turn it on in Settings > Privacy opt-outs to send.', 'the user opted out of ERC-4337'),
    withdrawalInvalidRecipient: () => expectedError('Please enter a valid address to send to.', 'invalid withdrawal recipient'),
    withdrawalInFlight: () => expectedError('Another transfer from a Privacy Pools account is still in progress. Please wait for it to finish.', 'a withdrawal is already in flight'),
    withdrawalBatchNotSimulated: () => expectedError('This transfer combines several of your deposits, and we could not confirm it would go through, so it was not sent. Please try again in a moment, or send a smaller amount.', 'a batch withdrawal could not be simulated'),
    withdrawalFeeAboveAmount: (sdkError) => new EmittableError_1.default({
        message: 'This amount is too small to cover the network fee for sending it. Please try a larger amount.',
        level: 'expected',
        error: sdkError
    }),
    withdrawalNotReady: () => expectedError('There is no transfer ready to send.', 'no prepared withdrawal')
};
//# sourceMappingURL=errors.js.map