import { concat, hexlify, Interface, toBeHex, ZeroAddress } from 'ethers'
import { NetworkDescriptor } from 'interfaces/networkDescriptor'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import AmbireAccountNoRevert from '../../../contracts/compiled/AmbireAccountNoRevert.json'
import { AMBIRE_ACCOUNT_FACTORY, AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { Bundler } from '../../services/bundlers/bundler'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getFeeCall } from '../calls/calls'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { UserOperation } from '../userOperation/types'
import {
  getOneTimeNonce,
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../userOperation/userOperation'
import { estimationErrorFormatted } from './errors'
import { Erc4337GasLimits, EstimateResult, FeeToken } from './interfaces'

function getUserOpsForEstimate(
  userOp: UserOperation,
  op: AccountOp,
  isDeployed: boolean
): UserOperation[] {
  const ambireAccount = new Interface(AmbireAccount.abi)
  const uOp = { ...userOp }
  const userOps = []

  if (!isDeployed) {
    // this one doesn't have the initCode and will get stateOverriden
    // to have the code and entry point permissions. Goal: call data estimate
    const copy = { ...userOp }
    copy.initCode = '0x'
    copy.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)])
    copy.signature = getSigForCalculations()
    userOps.push(copy)

    // this one will have initCode but empty callData. Goal: deploy estimate
    const factoryInterface = new Interface(AmbireAccountFactory.abi)
    uOp.sender = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, AmbireAccountNoRevert.bin)
    uOp.initCode = hexlify(
      concat([
        AMBIRE_ACCOUNT_FACTORY,
        factoryInterface.encodeFunctionData('deploy', [AmbireAccountNoRevert.bin, toBeHex(0, 32)])
      ])
    )
    uOp.callData = ambireAccount.encodeFunctionData('executeMultiple', [[]])
    uOp.nonce = getOneTimeNonce(uOp)
  } else {
    // executeBySender as contract is deployed. If entry point does not have
    // permissions, we do a state override to make it have
    uOp.callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)])
    uOp.signature = getSigForCalculations()
  }

  userOps.push(uOp)
  return userOps
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
  // build the fee payment options as we'll return them even if there's an error
  const feePaymentOptions = feeTokens.map((token: FeeToken) => {
    return {
      address: token.address,
      paidBy: account.addr,
      availableAmount: token.amount,
      // @relyOnBundler
      // gasUsed goes to 0
      // we add a transfer call or a native call when sending the uOp to the
      // bundler and he estimates that. For different networks this gasUsed
      // goes to different places (callGasLimit or preVerificationGas) and
      // its calculated differently. So it's a wild bet to think we could
      // calculate this on our own for each network.
      gasUsed: 0n,
      // addedNative gets calculated by the bundler & added to uOp gasData
      addedNative: 0n,
      isGasTank: token.isGasTank
    }
  })

  const localOp = { ...op }
  const feeToken = getFeeTokenForEstimate(feeTokens)
  if (feeToken) localOp.feeCall = getFeeCall(feeToken, 1n)
  const accountState = accountStates[localOp.accountAddr][localOp.networkId]
  const userOp = getUserOperation(account, accountState, localOp)
  const gasPrices = await Bundler.fetchGasPrices(network).catch(
    () => new Error('Could not fetch gas prices, retrying...')
  )
  if (gasPrices instanceof Error) return estimationErrorFormatted(gasPrices, feePaymentOptions)

  // use medium for the gas limit estimation
  userOp.maxFeePerGas = gasPrices.medium.maxFeePerGas
  userOp.maxPriorityFeePerGas = gasPrices.medium.maxPriorityFeePerGas

  // add fake data so simulation works
  if (network.erc4337.hasPaymaster) userOp.paymasterAndData = getPaymasterDataForEstimate()

  if (userOp.activatorCall) localOp.activatorCall = userOp.activatorCall
  const userOps = getUserOpsForEstimate(userOp, localOp, accountState.isDeployed)
  const estimations = userOps.map((uOp) =>
    Bundler.estimate(uOp, network).catch((e: any) =>
      mapError(
        new Error(
          e.error && e.error.message ? e.error.message : 'Estimation failed with unknown reason'
        )
      )
    )
  )

  const results = await Promise.all(estimations)
  for (let i = 0; i < results.length; i++) {
    if (results[i] instanceof Error)
      return estimationErrorFormatted(results[i] as Error, feePaymentOptions)
  }

  const callDataRes = results[0] as Erc4337GasLimits
  const verificationRes = results[results.length - 1] as Erc4337GasLimits
  const gasData = {
    preVerificationGas: BigInt(verificationRes.preVerificationGas),
    verificationGasLimit: BigInt(verificationRes.verificationGasLimit),
    callGasLimit: BigInt(callDataRes.callGasLimit)
  }

  const apeMaxFee = BigInt(gasPrices.fast.maxFeePerGas) + BigInt(gasPrices.fast.maxFeePerGas) / 5n
  const apePriority =
    BigInt(gasPrices.fast.maxPriorityFeePerGas) + BigInt(gasPrices.fast.maxPriorityFeePerGas) / 5n
  const ape = {
    maxFeePerGas: toBeHex(apeMaxFee),
    maxPriorityFeePerGas: toBeHex(apePriority)
  }

  return {
    gasUsed: gasData.callGasLimit,
    // the correct nonce for the userOp cannot be determined here as
    // if the request type is not standard, it will completely change
    nonce: Number(BigInt(userOp.nonce).toString()),
    feePaymentOptions,
    erc4337GasLimits: {
      preVerificationGas: toBeHex(gasData.preVerificationGas),
      verificationGasLimit: toBeHex(gasData.verificationGasLimit),
      callGasLimit: toBeHex(gasData.callGasLimit),
      gasPrice: { ...gasPrices, ape }
    },
    error: null
  }
}
