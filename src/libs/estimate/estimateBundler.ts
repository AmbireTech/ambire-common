import { Interface, toBeHex, ZeroAddress } from 'ethers'
import { UserOperation } from 'libs/userOperation/types'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Bundler } from '../../services/bundlers/bundler'
import { getPaymasterStubData } from '../../services/sponsorship/paymasterSponsor'
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

function getEstimationError(e: any): Error {
  let errMsg = e.error.message ? e.error.message : 'Estimation failed with unknown reason'
  const hex = errMsg.indexOf('0x') !== -1 ? errMsg.substring(errMsg.indexOf('0x')) : null
  const decodedHex = hex ? mapTxnErrMsg(hex) : null
  if (decodedHex) errMsg = errMsg.replace(hex, decodedHex)
  return mapError(new Error(errMsg))
}

async function getSponsoredUserOp(
  op: AccountOp,
  userOp: UserOperation,
  network: NetworkDescriptor
): Promise<UserOperation | null> {
  if (!op.meta?.capabilities?.paymasterService?.url) return null

  const sponsoredUserOp = { ...userOp }
  const localOp = { ...op }

  // delete the fee call as we're not including it in the sponsorship
  delete localOp.feeCall
  const ambireAccount = new Interface(AmbireAccount.abi)
  sponsoredUserOp.callData = ambireAccount.encodeFunctionData('executeBySender', [
    getSignableCalls(localOp)
  ])
  const stubData = await getPaymasterStubData(
    op.meta?.capabilities?.paymasterService?.url,
    network,
    userOp
  )
  sponsoredUserOp.paymaster = stubData.paymaster
  sponsoredUserOp.paymasterPostOpGasLimit = stubData.paymasterPostOpGasLimit
  sponsoredUserOp.paymasterVerificationGasLimit = stubData.paymasterVerificationGasLimit
  sponsoredUserOp.paymasterData = stubData.paymasterData
  sponsoredUserOp.signature = getSigForCalculations()
  return sponsoredUserOp
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

  // set the callData
  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall
  const ambireAccount = new Interface(AmbireAccount.abi)
  userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(localOp)])

  // add fake data so simulation works
  if (usesPaymaster) {
    const paymasterUnpacked = getPaymasterDataForEstimate()
    userOp.paymaster = paymasterUnpacked.paymaster
    userOp.paymasterPostOpGasLimit = paymasterUnpacked.paymasterPostOpGasLimit
    userOp.paymasterVerificationGasLimit = paymasterUnpacked.paymasterVerificationGasLimit
    userOp.paymasterData = paymasterUnpacked.paymasterData
  }

  userOp.signature = getSigForCalculations()
  const shouldStateOverride = !accountState.isErc4337Enabled && accountState.isDeployed
  const sponsoredUserOp = await getSponsoredUserOp(op, userOp, network)
  const [gasData, sponsoredGasData] = await Promise.all([
    Bundler.estimate(userOp, network, shouldStateOverride).catch((e: any) => getEstimationError(e)),
    Bundler.estimateSponsorship(sponsoredUserOp, network, shouldStateOverride).catch((e: any) =>
      getEstimationError(e)
    )
  ])
  if (gasData instanceof Error && sponsoredGasData instanceof Error)
    return estimationErrorFormatted(gasData as Error, { feePaymentOptions })

  const apeMaxFee = BigInt(gasPrices.fast.maxFeePerGas) + BigInt(gasPrices.fast.maxFeePerGas) / 5n
  const apePriority =
    BigInt(gasPrices.fast.maxPriorityFeePerGas) + BigInt(gasPrices.fast.maxPriorityFeePerGas) / 5n
  const ape = {
    maxFeePerGas: toBeHex(apeMaxFee),
    maxPriorityFeePerGas: toBeHex(apePriority)
  }
  // this indicates whether the estimation succeeds with out options.
  // This is needed in the case of dApp sponsorship.
  // For example, the user doesn't have any funds in his wallet so we reject
  // his userOps as he doesn't have the fee to pay our paymaster. But the
  // dApp sponsors his transaction => it's valid in the sponsorship estimation
  const ambireEstimationSuccess = !(gasData instanceof Error)

  return {
    gasUsed: ambireEstimationSuccess ? BigInt(gasData.callGasLimit) : 0n,
    currentAccountNonce: Number(op.nonce),
    feePaymentOptions,
    erc4337GasLimits: {
      preVerificationGas: ambireEstimationSuccess ? gasData.preVerificationGas : '0x',
      verificationGasLimit: ambireEstimationSuccess ? gasData.verificationGasLimit : '0x',
      callGasLimit: ambireEstimationSuccess ? gasData.callGasLimit : '0x',
      paymasterVerificationGasLimit: ambireEstimationSuccess
        ? gasData.paymasterVerificationGasLimit
        : '0x',
      paymasterPostOpGasLimit: ambireEstimationSuccess ? gasData.paymasterPostOpGasLimit : '0x',
      gasPrice: { ...gasPrices, ape },
      sponsorship: sponsoredGasData
    },
    error: null
  }
}
