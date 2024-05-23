import { Interface, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Bundler } from '../../services/bundlers/bundler'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getFeeCall } from '../calls/calls'
import { TokenResult } from '../portfolio'
import {
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation,
  shouldUsePaymaster
} from '../userOperation/userOperation'
import { estimationErrorFormatted, mapTxnErrMsg } from './errors'
import { EstimateResult, FeePaymentOption } from './interfaces'

function getFeeTokenForEstimate(feeTokens: TokenResult[]): TokenResult | null {
  if (!feeTokens.length) return null

  const erc20token = feeTokens.find(
    (feeToken) =>
      feeToken.address !== ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  if (erc20token) return erc20token

  const nativeToken = feeTokens.find(
    (feeToken) =>
      feeToken.address === ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  if (nativeToken) return nativeToken

  const gasTankToken = feeTokens.find(
    (feeToken) => feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  return gasTankToken ?? null
}

// try to humanize a bit more the error message
function mapError(e: Error) {
  if (e.message.includes('paymaster deposit too low')) {
    return new Error(
      `Paymaster with address ${AMBIRE_PAYMASTER} does not have enough funds to execute this request. Please contact support`
    )
  }

  return e
}

export async function bundlerEstimate(
  account: Account,
  accountStates: AccountStates,
  op: AccountOp,
  network: NetworkDescriptor,
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

  const usesPaymaster = shouldUsePaymaster(network)
  if (usesPaymaster) {
    const feeToken = getFeeTokenForEstimate(feeTokens)
    if (feeToken) localOp.feeCall = getFeeCall(feeToken, 1n)
  }
  const userOp = getUserOperation(
    account,
    accountState,
    localOp,
    !accountState.isDeployed ? op.meta!.entryPointAuthorization : undefined
  )
  const gasPrices = await Bundler.fetchGasPrices(network).catch(
    () => new Error('Could not fetch gas prices, retrying...')
  )
  if (gasPrices instanceof Error) return estimationErrorFormatted(gasPrices, { feePaymentOptions })

  // add the maxFeePerGas and maxPriorityFeePerGas only if the network
  // is optimistic as the bundler uses these values to determine the
  // preVerificationGas.
  if (network.isOptimistic) {
    // use medium for the gas limit estimation
    userOp.maxPriorityFeePerGas = gasPrices.medium.maxPriorityFeePerGas
    userOp.maxFeePerGas = gasPrices.medium.maxFeePerGas
  }

  // add fake data so simulation works
  if (usesPaymaster) {
    const paymasterUnpacked = getPaymasterDataForEstimate()
    userOp.paymaster = paymasterUnpacked.paymaster
    userOp.paymasterPostOpGasLimit = paymasterUnpacked.paymasterPostOpGasLimit
    userOp.paymasterVerificationGasLimit = paymasterUnpacked.paymasterVerificationGasLimit
    userOp.paymasterData = paymasterUnpacked.paymasterData
  }

  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall

  const ambireAccount = new Interface(AmbireAccount.abi)
  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(localOp)])
  userOp.signature = getSigForCalculations()

  const shouldStateOverride = !accountState.isErc4337Enabled && accountState.isDeployed
  const gasData = await Bundler.estimate(userOp, network, shouldStateOverride).catch((e: any) => {
    let errMsg = e.error.message ? e.error.message : 'Estimation failed with unknown reason'
    const hex = errMsg.indexOf('0x') !== -1 ? errMsg.substring(errMsg.indexOf('0x')) : null
    const decodedHex = hex ? mapTxnErrMsg(hex) : null
    if (decodedHex) errMsg = errMsg.replace(hex, decodedHex)
    return mapError(new Error(errMsg))
  })
  if (gasData instanceof Error)
    return estimationErrorFormatted(gasData as Error, { feePaymentOptions })

  const apeMaxFee = BigInt(gasPrices.fast.maxFeePerGas) + BigInt(gasPrices.fast.maxFeePerGas) / 5n
  const apePriority =
    BigInt(gasPrices.fast.maxPriorityFeePerGas) + BigInt(gasPrices.fast.maxPriorityFeePerGas) / 5n
  const ape = {
    maxFeePerGas: toBeHex(apeMaxFee),
    maxPriorityFeePerGas: toBeHex(apePriority)
  }

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
      gasPrice: { ...gasPrices, ape }
    },
    error: null
  }
}
