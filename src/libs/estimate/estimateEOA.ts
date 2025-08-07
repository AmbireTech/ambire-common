import { AbiCoder, JsonRpcProvider, Provider, ZeroAddress } from 'ethers'

import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Account, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getEoaSimulationStateOverride } from '../../utils/simulationStateOverride'
import { AccountOp, toSingletonCall } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { TokenResult } from '../portfolio'
import { estimationErrorFormatted } from './errors'
import { estimateWithRetries } from './estimateWithRetries'
import { EstimateResult } from './interfaces'

const abiCoder = new AbiCoder()

export async function estimateEOA(
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  network: Network,
  provider: JsonRpcProvider | Provider,
  feeTokens: TokenResult[],
  blockFrom: string,
  blockTag: string | number,
  errorCallback: Function
): Promise<EstimateResult> {
  if (op.calls.length !== 1)
    return estimationErrorFormatted(
      new Error(
        "Trying to make multiple calls with an EOA account which shouldn't happen. Please try again or contact support."
      )
    )

  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const optimisticOracle = network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress
  const call = op.calls[0]
  // TODO: try to remove this call
  const nonce = await provider.getTransactionCount(account.addr)
  const accountState = accountStates[op.accountAddr][op.chainId.toString()]
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
    [call.data, call.to ?? ZeroAddress, account.addr, 100000000, 2, nonce, 100000]
  )
  const initializeRequests = () => [
    provider
      .estimateGas({
        from: account.addr,
        to: call.to ?? undefined,
        value: call.value,
        data: call.data,
        nonce
      })
      .catch(getHumanReadableEstimationError),
    !network.rpcNoStateOverride
      ? deploylessEstimator
          .call(
            'estimateEoa',
            [
              account.addr,
              [account.addr, EOA_SIMULATION_NONCE, op.calls.map(toSingletonCall), '0x'],
              encodedCallData,
              [account.addr],
              FEE_COLLECTOR,
              optimisticOracle
            ],
            {
              from: blockFrom,
              blockTag,
              mode: DeploylessMode.StateOverride,
              stateToOverride: getEoaSimulationStateOverride(account.addr)
            }
          )
          .catch((e) => {
            console.log('error calling estimateEoa:', e)
            return [[0n, [], {}]]
          })
      : deploylessEstimator
          .call('getL1GasEstimation', [encodedCallData, FEE_COLLECTOR, optimisticOracle], {
            from: blockFrom,
            blockTag
          })
          .catch(getHumanReadableEstimationError)
  ]
  const result = await estimateWithRetries(initializeRequests, 'estimation-eoa', errorCallback)
  const feePaymentOptions = [
    {
      paidBy: account.addr,
      availableAmount: accountState.balance,
      addedNative: 0n,
      token: feeTokens.find((token) => token.address === ZeroAddress && !token.flags.onGasTank)!,
      gasUsed: 21000n
    }
  ]
  if (result instanceof Error) return estimationErrorFormatted(result, { feePaymentOptions })
  const foundError = Array.isArray(result) ? result.find((res) => res instanceof Error) : null
  if (foundError instanceof Error)
    return estimationErrorFormatted(foundError, { feePaymentOptions })

  let gasUsed = 0n
  if (!network.rpcNoStateOverride) {
    const [gasUsedEstimateGas, [[gasUsedEstimationSol, feeTokenOutcomes, l1GasEstimation]]] =
      result as any
    if (feeTokenOutcomes.length && feeTokenOutcomes[0].length) {
      feePaymentOptions[0].availableAmount = feeTokenOutcomes[0][1]
    }
    if (l1GasEstimation && l1GasEstimation.fee) {
      feePaymentOptions[0].addedNative = l1GasEstimation.fee
    }

    // if it's a simple transfer, trust estimateGas as it should be 21K
    // if it's a contract call, trust whichever is higher
    if (call.data === '0x') gasUsed = gasUsedEstimateGas
    else
      gasUsed =
        gasUsedEstimateGas > gasUsedEstimationSol ? gasUsedEstimateGas : gasUsedEstimationSol
  } else {
    const [gasUsedEstimateGas, [l1GasEstimation]] = result as any
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
