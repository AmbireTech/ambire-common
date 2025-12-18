/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
/* eslint-disable no-constant-condition */

import { Interface, toBeHex } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { EIP7702Auth } from '../../consts/7702'
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
import { PaymasterEstimationData } from '../erc7677/types'
import { DecodedError } from '../errorDecoder/types'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { TokenResult } from '../portfolio'
import { fetchNonce } from '../userOperation/fetchEntryPointNonce'
import { UserOperation } from '../userOperation/types'
import { getSigForCalculations, getUserOperation } from '../userOperation/userOperation'
import { BundlerEstimateResult, Erc4337GasLimits, EstimationFlags } from './interfaces'

export async function fetchBundlerGasPrice(
  baseAcc: BaseAccount,
  network: Network,
  switcher: BundlerSwitcher
): Promise<GasSpeeds | Error> {
  const bundler = switcher.getBundler()

  // fetchGasPrices should complete in ms, so punish slow bundlers
  // by rotating them off
  const prices = await Promise.race([
    bundler.fetchGasPrices(network).catch(() => {
      return new Error('Could not fetch gas prices, retrying...')
    }),
    new Promise((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('bundler gas request too slow')),
        switcher.canSwitch(baseAcc) ? 4000 : 10000
      )
    })
  ]).catch(() => {
    // eslint-disable-next-line no-console
    console.error(`fetchBundlerGasPrice for ${bundler.getName()} failed`)
    return Error('Failed to fetch bundler gas prices')
  })

  if (prices instanceof Error && switcher.canSwitch(baseAcc)) {
    switcher.switch()
    return fetchBundlerGasPrice(baseAcc, network, switcher)
  }

  return prices as GasSpeeds | Error
}

async function estimate(
  baseAcc: BaseAccount,
  network: Network,
  userOp: UserOperation,
  switcher: BundlerSwitcher,
  gasPrice: GasSpeeds
): Promise<{
  estimation: BundlerEstimateResult | Error
  nonFatalErrors: Error[]
}> {
  const bundler = switcher.getBundler()

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
      // we just can't decode the error because it's too custom
      // so it's better to continue forward with the original one
      // eslint-disable-next-line no-console
      console.error(error)
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
  gasPrice: GasSpeeds,
  switcher: BundlerSwitcher,
  eip7702Auth?: EIP7702Auth,
  pendingUserOp?: SubmittedAccountOp
): Promise<Erc4337GasLimits | Error | null> {
  if (!baseAcc.supportsBundlerEstimation()) return null

  const account = baseAcc.getAccount()
  const localOp = { ...op }
  const initialBundler = switcher.getBundler()
  const userOp = getUserOperation({
    account,
    accountState,
    accountOp: localOp,
    bundler: initialBundler.getName(),
    entryPointSig: op.meta?.entryPointAuthorization,
    eip7702Auth,
    hasPendingUserOp: !!pendingUserOp
  })
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
  let latestGasPrice = gasPrice
  while (true) {
    // estimate
    const estimations = await estimate(baseAcc, network, userOp, switcher, latestGasPrice)

    // if no errors, return the results and get on with life
    if (!(estimations.estimation instanceof Error)) {
      const gasData = estimations.estimation
      return {
        preVerificationGas: gasData.preVerificationGas,
        verificationGasLimit: gasData.verificationGasLimit,
        callGasLimit: gasData.callGasLimit,
        paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
        gasPrice: latestGasPrice,
        feePaymentOptions: feeTokens.map((t) => ({
          availableAmount: t.amount,
          paidBy: account.addr,
          gasUsed: 0n,
          addedNative: 0n,
          token: t
        })),
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

      // wait a bit to allow the state to sync
      await wait(2000)
      const accountNonce = await fetchNonce(account, provider)
      if (accountNonce === null || accountNonce === 0n) {
        // RPC serious malfunction
        return estimations.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE')!
      }

      if (network.chainId === 1n && BigInt(userOp.nonce) === BigInt(accountNonce)) {
        return estimations.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE')!
      }

      userOp.nonce = toBeHex(accountNonce)
      continue
    }

    // if there's an error but we can't switch, return the error
    if (!switcher.canSwitch(baseAcc)) return estimations.estimation

    // try again
    switcher.switch()

    // after switching the bundler, we need to fetch the gas prices from the
    // selected bundler. Otherwise, we run the risk of the userOp not being
    // accepted by the new bundler
    const newBundlerGasPrice = await fetchBundlerGasPrice(baseAcc, network, switcher)
    if (newBundlerGasPrice instanceof Error) return newBundlerGasPrice
    latestGasPrice = newBundlerGasPrice
  }
}
