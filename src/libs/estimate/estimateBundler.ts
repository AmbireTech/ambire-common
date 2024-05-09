import { Interface, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { KeystoreSigner } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Bundler } from '../../services/bundlers/bundler'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getFeeCall } from '../calls/calls'
import { TokenResult } from '../portfolio'
import {
  getDummyEntryPointSig,
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../userOperation/userOperation'
import { estimationErrorFormatted } from './errors'
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
  signer: KeystoreSigner,
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
  const feeToken = getFeeTokenForEstimate(feeTokens)
  if (feeToken) localOp.feeCall = getFeeCall(feeToken, 1n)
  const accountState = accountStates[localOp.accountAddr][localOp.networkId]
  const userOp = getUserOperation(
    account,
    accountState,
    localOp,
    await getDummyEntryPointSig(account.addr, network.chainId, signer)
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
  if (network.erc4337.hasPaymaster) {
    const paymasterUnpacked = getPaymasterDataForEstimate()
    userOp.paymaster = paymasterUnpacked.paymaster
    userOp.paymasterData = paymasterUnpacked.paymasterData
  }

  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall

  const ambireAccount = new Interface(AmbireAccount.abi)
  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)])
  userOp.signature = getSigForCalculations()

  const gasData = await Bundler.estimate(userOp, network).catch((e: any) => {
    return mapError(
      new Error(
        e.error && e.error.message ? e.error.message : 'Estimation failed with unknown reason'
      )
    )
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
