/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
/* eslint-disable no-constant-condition */

import { Interface, toBeHex } from 'ethers'

import { DecodedError } from 'libs/errorDecoder/types'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import EntryPoint from '../../../contracts/compiled/EntryPoint.json'
import { EIP7702Auth } from '../../consts/7702'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
import { paymasterFactory } from '../../services/paymaster'
import wait from '../../utils/wait'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { SubmittedAccountOp } from '../accountOp/submittedAccountOp'
import { AccountOpStatus } from '../accountOp/types'
import { PaymasterEstimationData } from '../erc7677/types'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'
import { getSigForCalculations, getUserOperation } from '../userOperation/userOperation'
import { BundlerEstimateResult, Erc4337GasLimits, EstimationFlags } from './interfaces'

async function fetchBundlerGasPrice(
  baseAcc: BaseAccount,
  network: Network,
  switcher: BundlerSwitcher,
  errorCallback: Function
): Promise<GasSpeeds | Error> {
  const bundler = switcher.getBundler()
  const fetchGas = bundler.fetchGasPrices(network, errorCallback).catch(() => {
    return new Error('Could not fetch gas prices, retrying...')
  })

  // if there aren't any bundlers available, just go with the original
  // gas price fetch that auto retries on failure as we don't have a choice
  if (!switcher.canSwitch(baseAcc)) return fetchGas

  // fetchGasPrices should complete in ms, so punish slow bundlers
  // by rotating them off
  const prices = await Promise.race([
    fetchGas,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('bundler gas request too slow')), 4000)
    })
  ]).catch(() => {
    // eslint-disable-next-line no-console
    console.error(`fetchBundlerGasPrice for ${bundler.getName()} failed, switching and retrying`)
    return null
  })

  if (!prices || prices instanceof Error) {
    switcher.switch()
    return fetchBundlerGasPrice(baseAcc, network, switcher, errorCallback)
  }

  return prices as GasSpeeds | Error
}

async function estimate(
  baseAcc: BaseAccount,
  network: Network,
  userOp: UserOperation,
  switcher: BundlerSwitcher,
  errorCallback: Function,
  options?: {
    pendingUserOp?: SubmittedAccountOp
    gasPrices?: GasSpeeds | null
  }
): Promise<{
  gasPrice: GasSpeeds | Error
  estimation: BundlerEstimateResult | Error
  nonFatalErrors: Error[]
}> {
  const gasPrice = options?.gasPrices
    ? options.gasPrices
    : await fetchBundlerGasPrice(baseAcc, network, switcher, errorCallback)
  const bundler = switcher.getBundler()

  // if the gasPrice fetch fails, we will switch the bundler and try again
  if (gasPrice instanceof Error) {
    return {
      gasPrice,
      // if gas prices couldn't be fetched, it means there's an internal error
      estimation: Error('Failed to fetch gas prices, retrying...'),
      nonFatalErrors: []
    }
  }

  // if there's a pending userOp in the activity
  // and it has the same userOp nonce as this txn,
  // resolve the bundler estimation with a failure
  if (
    options &&
    options.pendingUserOp &&
    options.pendingUserOp.asUserOperation &&
    options.pendingUserOp.status === AccountOpStatus.BroadcastedButNotConfirmed &&
    BigInt(options.pendingUserOp.asUserOperation.nonce) === BigInt(userOp.nonce)
  ) {
    const error = new Error('4337 invalid account nonce', { cause: '4337_INVALID_NONCE' })
    return {
      gasPrice,
      // if gas prices couldn't be fetched, it means there's an internal error
      estimation: error,
      nonFatalErrors: [error]
    }
  }

  // add the maxFeePerGas and maxPriorityFeePerGas only if the network
  // is optimistic as the bundler uses these values to determine the
  // preVerificationGas.
  const localUserOp = { ...userOp }
  if (network.isOptimistic) {
    // use medium for the gas limit estimation
    localUserOp.maxPriorityFeePerGas = gasPrice.fast.maxPriorityFeePerGas
    localUserOp.maxFeePerGas = gasPrice.fast.maxFeePerGas
  }

  const nonFatalErrors: Error[] = []
  const estimateErrorCallback = (e: Error) => {
    let decodedError: Error | DecodedError = e
    try {
      decodedError = bundler.decodeBundlerError(e)
    } catch (error) {
      // silence, we just can't decode the error because it's too custom
      // so it's better to continue forward with the original one
    }

    // if the bundler estimation fails, add a nonFatalError so we can react to
    // it on the FE. The BE at a later stage decides if this error is actually fatal
    nonFatalErrors.push(new Error('Bundler estimation failed', { cause: '4337_ESTIMATION' }))

    if (e.message.indexOf('invalid account nonce') !== -1) {
      nonFatalErrors.push(new Error('4337 invalid account nonce', { cause: '4337_INVALID_NONCE' }))
    }

    const humanReadable = getHumanReadableEstimationError(decodedError)
    humanReadable.cause = '4337_ESTIMATION'
    return humanReadable
  }

  const stateOverride = baseAcc.getBundlerStateOverride(localUserOp)
  const estimationReq = bundler
    .estimate(localUserOp, network, stateOverride)
    .catch(estimateErrorCallback)
  const estimation = await Promise.race([
    estimationReq,
    new Promise((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('bundler estimation request too slow')),
        switcher.canSwitch(baseAcc) ? 6000 : 8000
      )
    })
  ]).catch(() => {
    // eslint-disable-next-line no-console
    console.error(`estimation for ${bundler.getName()} failed, switching and retrying`)
    return new Error('Failed to fetch the bundler estimation', { cause: '4337_ESTIMATION' })
  })

  return {
    gasPrice,
    estimation: estimation as BundlerEstimateResult | Error,
    nonFatalErrors
  }
}

export async function bundlerEstimate(
  baseAcc: BaseAccount,
  accountState: AccountOnchainState,
  op: AccountOp,
  network: Network,
  feeTokens: TokenResult[],
  provider: RPCProvider,
  switcher: BundlerSwitcher,
  errorCallback: Function,
  eip7702Auth?: EIP7702Auth,
  pendingUserOp?: SubmittedAccountOp
): Promise<Erc4337GasLimits | Error | null> {
  if (!baseAcc.supportsBundlerEstimation()) return null

  const account = baseAcc.getAccount()
  const localOp = { ...op }
  const initialBundler = switcher.getBundler()
  const userOp = getUserOperation(
    account,
    accountState,
    localOp,
    initialBundler.getName(),
    op.meta?.entryPointAuthorization,
    eip7702Auth
  )
  // set the callData
  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall

  const ambireAccount = new Interface(AmbireAccount.abi)
  userOp.signature = getSigForCalculations()

  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(localOp)])
  const paymaster = await paymasterFactory.create(op, userOp, account, network, provider)
  localOp.feeCall = paymaster.getFeeCallForEstimation(feeTokens)
  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(localOp)])
  const feeCallType = paymaster.getFeeCallType(feeTokens)

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
  let gasPrices: GasSpeeds | null = null
  while (true) {
    // estimate
    const estimations = await estimate(baseAcc, network, userOp, switcher, errorCallback, {
      // if we've tried to fetch the nonce 3 times and it's still the same nonce as
      // the pendingUserOp nonce, then there might be bundler broadcast problems.
      // In that case, we remove the pendingUserOp logic and leave it to the bundler
      pendingUserOp:
        flags.timesSeen4337NonceDiscrepancy && flags.timesSeen4337NonceDiscrepancy >= 3
          ? undefined
          : pendingUserOp,
      gasPrices
    })

    // if no errors, return the results and get on with life
    if (!(estimations.estimation instanceof Error)) {
      const gasData = estimations.estimation
      return {
        preVerificationGas: gasData.preVerificationGas,
        verificationGasLimit: gasData.verificationGasLimit,
        callGasLimit: gasData.callGasLimit,
        paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
        gasPrice: estimations.gasPrice as GasSpeeds,
        paymaster,
        flags,
        feeCallType
      }
    }

    // try again if the error is 4337_INVALID_NONCE and network is not ETH
    if (
      estimations.nonFatalErrors.length &&
      estimations.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE')
    ) {
      flags.has4337NonceDiscrepancy = true

      // cache the gas prices on 4337_INVALID_NONCE error as we're not changing the bundler
      if (!(estimations.gasPrice instanceof Error)) {
        gasPrices = estimations.gasPrice
      }

      // count the times we've found an invalid nonce
      if (!flags.timesSeen4337NonceDiscrepancy) flags.timesSeen4337NonceDiscrepancy = 0
      flags.timesSeen4337NonceDiscrepancy += 1

      // wait a bit to allow the state to sync
      await wait(2000)
      const ep = new Interface(EntryPoint)
      const accountNonce = await provider
        .call({
          to: ERC_4337_ENTRYPOINT,
          data: ep.encodeFunctionData('getNonce', [account.addr, 0]),
          blockTag: 'pending'
        })
        .catch(() => null)
      if (!accountNonce) continue

      if (network.chainId === 1n && BigInt(userOp.nonce) === BigInt(accountNonce)) {
        return estimations.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE')!
      }

      userOp.nonce = toBeHex(accountNonce)
      continue
    }

    // if there's an error but we can't switch, return the error
    if (!switcher.canSwitch(baseAcc)) return estimations.estimation

    // if there were cached gas prices, delete them
    gasPrices = null

    // try again
    switcher.switch()
  }
}
