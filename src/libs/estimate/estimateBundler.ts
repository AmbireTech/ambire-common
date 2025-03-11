/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
/* eslint-disable no-constant-condition */

import { Contract, Interface, toBeHex } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import entryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { Bundler } from '../../services/bundlers/bundler'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
import { paymasterFactory } from '../../services/paymaster'
import { AccountOp, getSignableCallsForBundlerEstimate } from '../accountOp/accountOp'
import { PaymasterEstimationData } from '../erc7677/types'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'
import { getSigForCalculations, getUserOperation } from '../userOperation/userOperation'
import { estimateWithRetries } from './estimateWithRetries'
import { Erc4337GasLimits, EstimationFlags } from './interfaces'

async function estimate(
  bundler: Bundler,
  network: Network,
  accountState: AccountOnchainState,
  userOp: UserOperation,
  errorCallback: Function
): Promise<{
  gasPrice: GasSpeeds | Error
  estimation: any
  nonFatalErrors: Error[]
}> {
  const gasPrice = await bundler.fetchGasPrices(network, errorCallback).catch(() => {
    return new Error('Could not fetch gas prices, retrying...')
  })

  // if the gasPrice fetch fails, we will switch the bundler and try again
  if (gasPrice instanceof Error) {
    const decodedError = bundler.decodeBundlerError(new Error('internal error'))
    return {
      gasPrice,
      // if gas prices couldn't be fetched, it means there's an internal error
      estimation: getHumanReadableEstimationError(decodedError),
      nonFatalErrors: []
    }
  }

  // add the maxFeePerGas and maxPriorityFeePerGas only if the network
  // is optimistic as the bundler uses these values to determine the
  // preVerificationGas.
  const localUserOp = { ...userOp }
  if (network.isOptimistic) {
    // use medium for the gas limit estimation
    localUserOp.maxPriorityFeePerGas = gasPrice.medium.maxPriorityFeePerGas
    localUserOp.maxFeePerGas = gasPrice.medium.maxFeePerGas
  }

  const nonFatalErrors: Error[] = []
  const estimateErrorCallback = (e: Error) => {
    const decodedError = bundler.decodeBundlerError(e)

    // if the bundler estimation fails, add a nonFatalError so we can react to
    // it on the FE. The BE at a later stage decides if this error is actually
    // fatal (at estimate.ts -> estimate4337)
    nonFatalErrors.push(new Error('Bundler estimation failed', { cause: '4337_ESTIMATION' }))

    if (decodedError.reason && decodedError.reason.indexOf('invalid account nonce') !== -1) {
      nonFatalErrors.push(new Error('4337 invalid account nonce', { cause: '4337_INVALID_NONCE' }))
    }

    return getHumanReadableEstimationError(decodedError)
  }
  // TODO<eip7702>
  // isEdgeCase should probably be adjusted for the first broadcast
  const isEdgeCase =
    !accountState.isSmarterEoa && !accountState.isErc4337Enabled && accountState.isDeployed
  // TODO: check if the bundler estimation is not good enough if we don't pass
  // the eip7702Auth props along
  // const initializeRequests = () => [
  //   accountState.authorization
  //     ? bundler
  //         .estimate7702(userOp, network, accountState.authorization)
  //         .catch(estimateErrorCallback)
  //     : bundler.estimate(userOp, network, isEdgeCase).catch(estimateErrorCallback)
  // ]
  const initializeRequests = () => [
    bundler.estimate(userOp, network, isEdgeCase).catch(estimateErrorCallback)
  ]

  const estimation = await estimateWithRetries(
    initializeRequests,
    'estimation-bundler',
    errorCallback
  )
  return {
    gasPrice,
    estimation,
    nonFatalErrors
  }
}

export async function bundlerEstimate(
  account: Account,
  accountState: AccountOnchainState,
  op: AccountOp,
  network: Network,
  feeTokens: TokenResult[],
  provider: RPCProvider,
  switcher: BundlerSwitcher,
  errorCallback: Function
): Promise<Erc4337GasLimits | Error> {
  // we're disallowing the bundler estimate for v1 accounts as they don't
  // have 4337 support
  if (!accountState.isV2 && !accountState.isEOA) return new Error('disallowed')

  const localOp = { ...op }

  // if the account is not a smarter EOA &
  // there's no entryPointAuthorization, we cannot do the estimation on deploy
  if (!accountState.isSmarterEoa && !accountState.isDeployed && !op.meta?.entryPointAuthorization)
    return new Error('Entry point privileges not granted. Please contact support')

  const initialBundler = switcher.getBundler()
  // TODO: check if the bundler estimation is not good enough if we don't pass
  // the eip7702Auth props along
  const userOp = getUserOperation(
    account,
    accountState,
    localOp,
    initialBundler.getName(),
    op.meta?.entryPointAuthorization
  )
  // set the callData
  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall

  const ambireAccount = new Interface(AmbireAccount.abi)
  userOp.signature = getSigForCalculations()

  const paymaster = await paymasterFactory.create(op, userOp, network, provider)
  localOp.feeCall = paymaster.getFeeCallForEstimation(feeTokens)
  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [
    getSignableCallsForBundlerEstimate(localOp)
  ])

  if (paymaster.isUsable()) {
    const paymasterEstimationData = paymaster.getEstimationData() as PaymasterEstimationData
    userOp.paymaster = paymasterEstimationData.paymaster
    userOp.paymasterData = paymasterEstimationData.paymasterData

    if (paymasterEstimationData.paymasterPostOpGasLimit)
      userOp.paymasterPostOpGasLimit = paymasterEstimationData.paymasterPostOpGasLimit

    if (paymasterEstimationData.paymasterVerificationGasLimit)
      userOp.paymasterVerificationGasLimit = paymasterEstimationData.paymasterVerificationGasLimit
  }

  const flags: EstimationFlags = {}
  while (true) {
    // estimate
    const bundler = switcher.getBundler()
    const estimations = await estimate(bundler, network, accountState, userOp, errorCallback)

    // if no errors, return the results and get on with life
    if (!(estimations.estimation instanceof Error)) {
      const gasData = estimations.estimation[0]
      return {
        preVerificationGas: gasData.preVerificationGas,
        verificationGasLimit: gasData.verificationGasLimit,
        callGasLimit: gasData.callGasLimit,
        paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
        gasPrice: estimations.gasPrice as GasSpeeds,
        paymaster,
        flags
      }
    }

    // try again if the error is 4337_INVALID_NONCE
    if (
      estimations.nonFatalErrors.length &&
      estimations.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE')
    ) {
      const ep = new Contract(ERC_4337_ENTRYPOINT, entryPointAbi, provider)
      let accountNonce = null
      // infinite loading is fine here as this is how 4337_INVALID_NONCE error
      // was handled in previous cases and worked pretty well: retry until fix
      while (!accountNonce) {
        accountNonce = await ep.getNonce(account.addr, 0, { blockTag: 'pending' }).catch(() => null)
      }
      userOp.nonce = toBeHex(accountNonce)
      flags.has4337NonceDiscrepancy = true
      continue
    }

    // if there's an error but we can't switch, return the error
    if (!switcher.canSwitch(account, estimations.estimation)) return estimations.estimation

    // try again
    switcher.switch()
  }
}
