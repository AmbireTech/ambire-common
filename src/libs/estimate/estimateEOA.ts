import { AbiCoder, JsonRpcProvider, Provider, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { TokenResult } from '../portfolio'
import { EOA_SIMULATION_NONCE } from '../portfolio/getOnchainBalances'
import { privSlot } from '../proxyDeploy/deploy'
import { catchEstimationFailure, estimationErrorFormatted } from './errors'
import { estimateWithRetries } from './estimateWithRetries'
import { EstimateResult } from './interfaces'

const abiCoder = new AbiCoder()

// this is the state override we use for the EOA when
// estimating through Estimation.sol
export function getEOAEstimationStateOverride(accountAddr: string) {
  return {
    [accountAddr]: {
      code: AmbireAccount.binRuntime,
      stateDiff: {
        // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
        [`0x${privSlot(0, 'address', accountAddr, 'bytes32')}`]:
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        // any number with leading zeros is not supported on some RPCs
        [toBeHex(1, 32)]: EOA_SIMULATION_NONCE
      }
    }
  }
}

export async function estimateEOA(
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  network: Network,
  provider: JsonRpcProvider | Provider,
  feeTokens: TokenResult[],
  blockFrom: string,
  blockTag: string | number
): Promise<EstimateResult> {
  if (op.calls.length !== 1)
    return estimationErrorFormatted(
      new Error(
        "Trying to make multiple calls with a Basic Account which shouldn't happen. Please try again or contact support."
      )
    )

  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const optimisticOracle = network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress
  const call = op.calls[0]
  // TODO: try to remove this call
  const nonce = await provider.getTransactionCount(account.addr)
  const accountState = accountStates[op.accountAddr][op.networkId]
  const encodedCallData = abiCoder.encode(
    [
      'bytes', // data
      'address', // to
      'address', // from
      'uint256', // gasPrice
      'uint256', // type
      'uint256', // nonce
      'uint256' // gasLimit
    ],
    [call.data, call.to, account.addr, 100000000, 2, nonce, 100000]
  )
  const initializeRequests = () => [
    provider
      .estimateGas({
        from: account.addr,
        to: call.to,
        value: call.value,
        data: call.data,
        nonce
      })
      .catch(catchEstimationFailure),
    !network.rpcNoStateOverride
      ? deploylessEstimator
          .call(
            'estimateEoa',
            [
              account.addr,
              [account.addr, EOA_SIMULATION_NONCE, op.calls, '0x'],
              encodedCallData,
              [account.addr],
              FEE_COLLECTOR,
              optimisticOracle
            ],
            {
              from: blockFrom,
              blockTag,
              mode: DeploylessMode.StateOverride,
              stateToOverride: getEOAEstimationStateOverride(account.addr)
            }
          )
          .catch(catchEstimationFailure)
      : deploylessEstimator
          .call('getL1GasEstimation', [encodedCallData, FEE_COLLECTOR, optimisticOracle], {
            from: blockFrom,
            blockTag
          })
          .catch(catchEstimationFailure)
  ]
  const result = await estimateWithRetries(initializeRequests)
  const feePaymentOptions = [
    {
      paidBy: account.addr,
      availableAmount: accountState.balance,
      addedNative: 0n,
      token: feeTokens.find((token) => token.address === ZeroAddress && !token.flags.onGasTank)!
    }
  ]
  if (result instanceof Error) return estimationErrorFormatted(result, { feePaymentOptions })

  let gasUsed = 0n
  if (!network.rpcNoStateOverride) {
    const [gasUsedEstimateGas, [[gasUsedEstimationSol, feeTokenOutcomes, l1GasEstimation]]] = result
    feePaymentOptions[0].availableAmount = feeTokenOutcomes[0][1]
    feePaymentOptions[0].addedNative = l1GasEstimation.fee

    // if it's a simple transfer, trust estimateGas as it should be 21K
    // if it's a contract call, trust whichever is higher
    if (call.data === '0x') gasUsed = gasUsedEstimateGas
    else
      gasUsed =
        gasUsedEstimateGas > gasUsedEstimationSol ? gasUsedEstimateGas : gasUsedEstimationSol
  } else {
    const [gasUsedEstimateGas, [l1GasEstimation]] = result
    feePaymentOptions[0].addedNative = l1GasEstimation.fee
    gasUsed = gasUsedEstimateGas
  }

  return {
    gasUsed,
    currentAccountNonce: nonce,
    feePaymentOptions,
    error: result instanceof Error ? result : null
  }
}
