import { concat, hexlify, Interface, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import {
  AMBIRE_ACCOUNT_FACTORY,
  AMBIRE_PAYMASTER,
  ENTRY_POINT_MARKER,
  ERC_4337_ENTRYPOINT,
  PROXY_NO_REVERTS
} from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Bundler } from '../../services/bundlers/bundler'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getFeeCall } from '../calls/calls'
import { getProxyDeployBytecode } from '../proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { UserOperation } from '../userOperation/types'
import {
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../userOperation/userOperation'
import { estimationErrorFormatted } from './errors'
import { EstimateResult, FeePaymentOption, FeeToken } from './interfaces'

function getUserOpForEstimate(
  userOp: UserOperation,
  op: AccountOp,
  isDeployed: boolean
): UserOperation {
  const ambireAccount = new Interface(AmbireAccount.abi)
  const uOp = { ...userOp }

  if (!isDeployed) {
    // replace the initCode with one that will not revert in estimation
    const factoryInterface = new Interface(AmbireAccountFactory.abi)
    const bytecode = getProxyDeployBytecode(
      PROXY_NO_REVERTS,
      [{ addr: ERC_4337_ENTRYPOINT, hash: ENTRY_POINT_MARKER }],
      { privSlot: 0 }
    )
    uOp.sender = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)
    uOp.initCode = hexlify(
      concat([
        AMBIRE_ACCOUNT_FACTORY,
        factoryInterface.encodeFunctionData('deploy', [bytecode, toBeHex(0, 32)])
      ])
    )
  }

  uOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)])
  uOp.signature = getSigForCalculations()
  return uOp
}

function getFeeTokenForEstimate(feeTokens: FeeToken[]): FeeToken | null {
  if (!feeTokens.length) return null

  const erc20token = feeTokens.find(
    (feeToken) => feeToken.address !== ZeroAddress && !feeToken.isGasTank && feeToken.amount > 0n
  )
  if (erc20token) return erc20token

  const nativeToken = feeTokens.find(
    (feeToken) => feeToken.address === ZeroAddress && !feeToken.isGasTank && feeToken.amount > 0n
  )
  if (nativeToken) return nativeToken

  const gasTankToken = feeTokens.find((feeToken) => feeToken.isGasTank && feeToken.amount > 0n)
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
  feeTokens: FeeToken[]
): Promise<EstimateResult> {
  // we pass an empty array of feePaymentOptions as they are built
  // in an upper level using the balances from Estimation.sol.
  // balances from Estimation.sol reflect the balances after pending txn exec
  const feePaymentOptions: FeePaymentOption[] = []
  const localOp = { ...op }
  const feeToken = getFeeTokenForEstimate(feeTokens)
  if (feeToken) localOp.feeCall = getFeeCall(feeToken, 1n)
  const accountState = accountStates[localOp.accountAddr][localOp.networkId]
  const userOp = getUserOperation(account, accountState, localOp)
  const gasPrices = await Bundler.fetchGasPrices(network).catch(
    () => new Error('Could not fetch gas prices, retrying...')
  )
  if (gasPrices instanceof Error) return estimationErrorFormatted(gasPrices, { feePaymentOptions })

  // add the maxFeePerGas and maxPriorityFeePerGas only if the network
  // is optimistic as the bundler uses these values to determine the
  // preVerificationGas.
  if (network.isOptimistic) {
    // use medium for the gas limit estimation
    userOp.maxFeePerGas = gasPrices.medium.maxFeePerGas
    userOp.maxPriorityFeePerGas = gasPrices.medium.maxPriorityFeePerGas
  }

  // add fake data so simulation works
  if (network.erc4337.hasPaymaster) userOp.paymasterAndData = getPaymasterDataForEstimate()

  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall
  const uOp = getUserOpForEstimate(userOp, localOp, accountState.isDeployed)
  const gasData = await Bundler.estimate(uOp, network).catch((e: any) =>
    mapError(
      new Error(
        e.error && e.error.message ? e.error.message : 'Estimation failed with unknown reason'
      )
    )
  )
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
      gasPrice: { ...gasPrices, ape }
    },
    error: null
  }
}
