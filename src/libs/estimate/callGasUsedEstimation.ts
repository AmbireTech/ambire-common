import { ZeroAddress } from 'ethers'
import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getEoaSimulationStateOverride } from '../../utils/simulationStateOverride'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, toSingletonCall } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { PerCallEstimation } from './interfaces'

export async function estimateEachCallSeparately(
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  provider: RPCProvider
): Promise<PerCallEstimation | Error | null> {
  if (!baseAcc.shouldBroadcastCallsSeparately(op)) return null

  const account = baseAcc.getAccount()
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const checkInnerCallsArgs = [
    account.addr,
    [account.addr, EOA_SIMULATION_NONCE, op.calls.map(toSingletonCall), '0x'],
    '0x',
    [account.addr],
    FEE_COLLECTOR,
    ZeroAddress
  ]
  const perCallEstimation = await deploylessEstimator
    .call('estimateEoa', checkInnerCallsArgs, {
      from: DEPLOYLESS_SIMULATION_FROM,
      blockTag: 'pending', // there's no reason to do latest
      mode: DeploylessMode.StateOverride,
      stateToOverride: getEoaSimulationStateOverride(account.addr)
    })
    .catch(getHumanReadableEstimationError)

  if (perCallEstimation instanceof Error) return perCallEstimation

  const [[gasUsed, , , gasUsedPerCall]] = perCallEstimation

  return {
    gasUsed,
    gasUsedPerCall
  }
}
