import { Interface } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { Account, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { Bundler } from '../../services/bundlers/bundler'
import { paymasterFactory } from '../../services/paymaster/PaymasterFactory'
import { AccountOp, getSignableCallsForBundlerEstimate } from '../accountOp/accountOp'
import { getFeeCall } from '../calls/calls'
import { PaymasterEstimationData } from '../erc7677/types'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { TokenResult } from '../portfolio'
import { getSigForCalculations, getUserOperation } from '../userOperation/userOperation'
import { estimationErrorFormatted } from './errors'
import { getFeeTokenForEstimate } from './estimateHelpers'
import { EstimateResult, FeePaymentOption } from './interfaces'

export async function bundlerEstimate(
  account: Account,
  accountStates: AccountStates,
  op: AccountOp,
  network: Network,
  feeTokens: TokenResult[]
): Promise<EstimateResult> {
  // we pass an empty array of feePaymentOptions as they are built
  // in an upper level using the balances from Estimation.sol.
  // balances from Estimation.sol reflect the balances after pending txn exec
  const feePaymentOptions: FeePaymentOption[] = []

  const localOp = { ...op }
  const accountState = accountStates[localOp.accountAddr][localOp.networkId]
  // if there's no entryPointAuthorization, we cannot do the estimation on deploy
  if (!accountState.isDeployed && (!op.meta || !op.meta.entryPointAuthorization))
    return estimationErrorFormatted(
      new Error('Entry point privileges not granted. Please contact support'),
      { feePaymentOptions }
    )

  const userOp = getUserOperation(
    account,
    accountState,
    localOp,
    !accountState.isDeployed ? op.meta!.entryPointAuthorization : undefined
  )
  // set the callData
  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall

  const gasPrice = await Bundler.fetchGasPrices(network).catch(
    () => new Error('Could not fetch gas prices, retrying...')
  )
  if (gasPrice instanceof Error) return estimationErrorFormatted(gasPrice, { feePaymentOptions })

  // add the maxFeePerGas and maxPriorityFeePerGas only if the network
  // is optimistic as the bundler uses these values to determine the
  // preVerificationGas.
  if (network.isOptimistic) {
    // use medium for the gas limit estimation
    userOp.maxPriorityFeePerGas = gasPrice.medium.maxPriorityFeePerGas
    userOp.maxFeePerGas = gasPrice.medium.maxFeePerGas
  }

  const ambireAccount = new Interface(AmbireAccount.abi)
  const isEdgeCase = !accountState.isErc4337Enabled && accountState.isDeployed
  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [
    getSignableCallsForBundlerEstimate(localOp)
  ])
  userOp.signature = getSigForCalculations()

  const paymaster = await paymasterFactory.create(op, userOp, network)
  if (paymaster.shouldIncludePayment()) {
    const feeToken = getFeeTokenForEstimate(feeTokens, network)
    if (feeToken) localOp.feeCall = getFeeCall(feeToken)

    // add the feeToken for estimation
    userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [
      getSignableCallsForBundlerEstimate(localOp)
    ])
  }

  if (paymaster.isUsable()) {
    const paymasterEstimationData = paymaster.getEstimationData() as PaymasterEstimationData
    userOp.paymaster = paymasterEstimationData.paymaster
    userOp.paymasterPostOpGasLimit = paymasterEstimationData.paymasterPostOpGasLimit
    userOp.paymasterVerificationGasLimit = paymasterEstimationData.paymasterVerificationGasLimit
    userOp.paymasterData = paymasterEstimationData.paymasterData
  }

  try {
    const gasData = await Bundler.estimate(userOp, network, isEdgeCase)

    return {
      gasUsed: BigInt(gasData.callGasLimit),
      currentAccountNonce: Number(op.nonce),
      feePaymentOptions,
      erc4337GasLimits: {
        preVerificationGas: gasData.preVerificationGas,
        verificationGasLimit: gasData.verificationGasLimit,
        callGasLimit: gasData.callGasLimit,
        paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
        gasPrice,
        paymaster
      },
      error: null
    }
  } catch (e: any) {
    const decodedError = Bundler.decodeBundlerError(e)

    const nonFatalErrors: Error[] = []
    // if the bundler estimation fails, add a nonFatalError so we can react to
    // it on the FE. The BE at a later stage decides if this error is actually
    // fatal (at estimate.ts -> estimate4337)
    nonFatalErrors.push(new Error('Bundler estimation failed', { cause: '4337_ESTIMATION' }))

    if (decodedError.indexOf('invalid account nonce') !== -1) {
      nonFatalErrors.push(new Error('4337 invalid account nonce', { cause: '4337_INVALID_NONCE' }))
    }

    const humanizedError = getHumanReadableEstimationError(e)

    return estimationErrorFormatted(humanizedError, { feePaymentOptions, nonFatalErrors })
  }
}
