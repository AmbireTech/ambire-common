import { JsonRpcProvider, ZeroAddress } from 'ethers'

import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { getEOAEstimationStateOverride } from '../estimate/estimateEOA'
import { EOA_SIMULATION_NONCE } from '../portfolio/getOnchainBalances'
import { Deployless, DeploylessMode } from './deployless'

export async function doesItSupportStateOverride(provider: JsonRpcProvider) {
  const estimator = new Deployless(provider, Estimation.abi, Estimation.bin, Estimation.binRuntime)

  // try to write to the state in deployless mode
  const accAddr = '0xc1e7354c7d11d95BDa4adf2A3Fd8984E1ddE7aCc'
  const result = await estimator
    .call(
      'estimateEoa',
      [
        accAddr,
        [
          accAddr,
          EOA_SIMULATION_NONCE,
          [['0x3e2D734349654166a2Ad92CaB2437A76a70B650a', 1n, '0x']],
          '0x'
        ],
        '0x',
        [accAddr],
        FEE_COLLECTOR,
        ZeroAddress
      ],
      {
        from: '0x0000000000000000000000000000000000000001',
        blockTag: 'latest',
        mode: DeploylessMode.StateOverride,
        stateToOverride: getEOAEstimationStateOverride(accAddr)
      }
    )
    .catch(() => {
      return 'not working'
    })

  return result !== 'not working'
}
