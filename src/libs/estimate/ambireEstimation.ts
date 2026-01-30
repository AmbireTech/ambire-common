import { ZeroAddress } from 'ethers'

import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM, OPTIMISTIC_ORACLE, SCROLL_ORACLE } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { SCROLL_CHAIN_ID } from '../../consts/networks'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getPendingBlockTagIfSupported } from '../../utils/getBlockTag'
import { getNotAmbireStateOverride } from '../../utils/simulationStateOverride'
import { getAccountDeployParams } from '../account/account'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, toSingletonCall } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { InnerCallFailureError } from '../errorDecoder/customErrors'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { GasTankTokenResult, TokenResult } from '../portfolio'
import { isNative } from '../portfolio/helpers'
import { getActivatorCall } from '../userOperation/userOperation'
import { AmbireEstimation, EstimationFlags, FeePaymentOption } from './interfaces'

function getOracleAddr(network: Network) {
  if (network.chainId === SCROLL_CHAIN_ID) {
    return SCROLL_ORACLE
  }

  if (network.isOptimistic) {
    return OPTIMISTIC_ORACLE
  }

  return ZeroAddress
}

export function getInnerCallFailure(
  estimationOp: { success: boolean; err: string },
  calls: Call[],
  network: Network,
  portfolioNativeValue?: bigint
): Error | null {
  if (estimationOp.success) return null

  return getHumanReadableEstimationError(
    new InnerCallFailureError(estimationOp.err, calls, network, portfolioNativeValue)
  )
}

// the outcomeNonce should always be equal to the nonce in accountOp + 1
// that's an indication of transaction success
export function getNonceDiscrepancyFailure(
  estimationNonce: bigint,
  outcomeNonce: number
): Error | null {
  if (estimationNonce + 1n === BigInt(outcomeNonce)) return null

  return new Error("Nonce discrepancy, perhaps there's a pending transaction. Retrying...", {
    cause: 'NONCE_FAILURE'
  })
}

export async function ambireEstimateGas(
  baseAcc: BaseAccount,
  accountState: AccountOnchainState,
  op: AccountOp,
  network: Network,
  provider: RPCProvider,
  feeTokens: TokenResult[],
  nativeToCheck: string[]
): Promise<AmbireEstimation | Error> {
  const account = baseAcc.getAccount()
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)

  // only the activator call is added here as there are cases where it's needed
  const calls = [...op.calls.map(toSingletonCall)]
  if (baseAcc.shouldIncludeActivatorCall()) {
    calls.push(getActivatorCall(op.accountAddr))
  }

  const shouldStateOverride =
    !network.rpcNoStateOverride && baseAcc.shouldStateOverrideDuringSimulations()
  const checkInnerCallsArgs = [
    account.addr,
    ...getAccountDeployParams(account),
    [account.addr, op.nonce || 1, calls, '0x'],
    getProbableCallData(op, accountState, baseAcc.shouldIncludeActivatorCall()),
    shouldStateOverride ? [account.addr] : account.associatedKeys,
    feeTokens.map((feeToken) => feeToken.address),
    FEE_COLLECTOR,
    nativeToCheck,
    getOracleAddr(network)
  ]
  const ambireEstimation = await deploylessEstimator
    .call('estimate', checkInnerCallsArgs, {
      from: DEPLOYLESS_SIMULATION_FROM,
      blockTag: getPendingBlockTagIfSupported(network),
      mode: shouldStateOverride ? DeploylessMode.StateOverride : DeploylessMode.Detect,
      stateToOverride: shouldStateOverride ? getNotAmbireStateOverride(account.addr) : null
    })
    .catch(getHumanReadableEstimationError)

  if (ambireEstimation instanceof Error) return ambireEstimation

  const {
    deployment,
    op: accountOp,
    nonce: outcomeNonce,
    feeTokenOutcomes,
    nativeAssetBalances,
    l1GasEstimation
  } = ambireEstimation

  const ambireEstimationError = getInnerCallFailure(
    accountOp,
    calls,
    network,
    feeTokens.find((token) => token.address === ZeroAddress && !token.flags.onGasTank)?.amount
  )

  if (ambireEstimationError) return ambireEstimationError

  // if there's a nonce discrepancy, it means the portfolio simulation
  // will fail so we need to update the account state and the portfolio
  const opNonce = shouldStateOverride ? BigInt(EOA_SIMULATION_NONCE) : op.nonce!
  const nonceError = getNonceDiscrepancyFailure(opNonce, outcomeNonce)
  const flags: EstimationFlags = {}
  flags.hasInitialGasLimitFailed = accountOp.initialGasLimitFailed

  if (nonceError) {
    flags.hasNonceDiscrepancy = true
  }

  const gasUsed = deployment.gasUsed + accountOp.gasUsed

  const feeTokenOptions: FeePaymentOption[] = feeTokens.map(
    (token: TokenResult | GasTankTokenResult, key: number) => {
      // We are using 'availableAmount' here, because it's possible the 'amount' to contains pending top up amount as well
      let availableAmount =
        token.flags.onGasTank && 'availableAmount' in token
          ? token.availableAmount || token.amount
          : feeTokenOutcomes[key].amount

      if (token.flags.onGasTank && op.meta?.topUpAmount) {
        availableAmount += op.meta.topUpAmount
      }

      // if the token is native and the account type cannot pay for the
      // transaction with the receiving amount from the estimation,
      // override the amount to the original, in-account amount.
      //
      // This isn't true when the amount is decreasing, though
      // We should subtract the amount if it's less the one he
      // currently owns as send all of native and paying in native
      // is impossible
      if (
        !token.flags.onGasTank &&
        token.address === ZeroAddress &&
        !baseAcc.canUseReceivingNativeForFee(token.amount) &&
        feeTokenOutcomes[key].amount > token.amount
      )
        availableAmount = token.amount

      // we make the native amount 0 as we always want to show it for better UX
      if (isNative(token) && !baseAcc.canBroadcastByItself()) {
        availableAmount = 0
      }

      return {
        paidBy: account.addr,
        availableAmount,
        // gasUsed for the gas tank tokens is smaller because of the commitment:
        // ['gasTank', amount, symbol]
        // and this commitment costs onchain:
        // - 1535, if the broadcasting addr is the relayer
        // - 4035, if the broadcasting addr is different
        // currently, there are more than 1 relayer addresses and we cannot
        // be sure which is the one that will broadcast this txn; also, ERC-4337
        // broadcasts will always consume at least 4035.
        // setting it to 5000n just be sure
        gasUsed: token.flags.onGasTank ? 5000n : feeTokenOutcomes[key].gasUsed,
        addedNative:
          token.address === ZeroAddress
            ? l1GasEstimation.feeWithNativePayment
            : l1GasEstimation.feeWithTransferPayment,
        token
      }
    }
  )

  // this is for EOAs paying for SA in native
  const nativeToken = feeTokens.find(
    (token) => token.address === ZeroAddress && !token.flags.onGasTank
  )
  const nativeTokenOptions: FeePaymentOption[] = nativeAssetBalances.map(
    (balance: bigint, key: number) => ({
      paidBy: nativeToCheck[key],
      availableAmount: balance,
      addedNative: l1GasEstimation.fee,
      token: {
        ...nativeToken,
        amount: balance
      }
    })
  )

  const originalNonce = shouldStateOverride ? op.nonce! : outcomeNonce
  return {
    gasUsed,
    deploymentGas: deployment.gasUsed,
    feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
    ambireAccountNonce: accountOp.success ? Number(originalNonce - 1n) : Number(originalNonce),
    flags
  }
}
