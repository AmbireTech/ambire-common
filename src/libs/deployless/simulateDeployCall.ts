import { FetchRequest, JsonRpcProvider, ZeroAddress } from 'ethers'

import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { AMBIRE_ACCOUNT_FACTORY, DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { getSmartAccount, getSpoof } from '../account/account'
import { callToTuple } from '../accountOp/accountOp'
import { getActivatorCall } from '../userOperation/userOperation'
import { DeploylessMode, fromDescriptor } from './deployless'

// simulate a deployless call to the given provider.
// if the call is successful, it means Ambire smart accounts are supported
// on the given network
export async function getSASupport(
  provider: JsonRpcProvider
): Promise<{ addressMatches: boolean; supportsStateOverride: boolean }> {
  const smartAccount = await getSmartAccount([
    {
      addr: DEPLOYLESS_SIMULATION_FROM,
      hash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    }
  ])
  const deploylessOptions = {
    blockTag: 'latest',
    from: DEPLOYLESS_SIMULATION_FROM,
    // very important to send to the AMBIRE_ACCOUNT_FACTORY
    // or else the SA address won't match
    to: AMBIRE_ACCOUNT_FACTORY,
    mode: DeploylessMode.StateOverride
  }
  const deployless = fromDescriptor(provider, AmbireFactory, true)
  let supportsStateOverride = true
  const result = await deployless
    .call(
      'deployAndExecute',
      [
        smartAccount.creation!.bytecode,
        smartAccount.creation!.salt,
        [callToTuple(getActivatorCall(smartAccount.addr))],
        getSpoof(smartAccount)
      ],
      deploylessOptions
    )
    .catch((e: any) => {
      if (e.message.includes('no response')) {
        throw new Error('no response')
      }

      // if there's an error, return the zero address indicating that
      // our smart accounts will most likely not work on this chain
      supportsStateOverride = false
      return [ZeroAddress]
    })

  return {
    addressMatches: result[0] === smartAccount.addr,
    supportsStateOverride
  }
}

export async function simulateDebugTraceCall(
  provider: JsonRpcProvider /* as Provider does not have .send */
): Promise<boolean> {
  let supportsDebugTraceCall = true

  // eslint-disable-next-line no-underscore-dangle
  const url = provider._getConnection().url

  const providerReq = new FetchRequest(url)
  providerReq.setThrottleParams({ maxAttempts: 1 })
  const noThrottleProvider = new JsonRpcProvider(providerReq)

  await noThrottleProvider
    .send('debug_traceCall', [
      {
        to: '0x888888888889c00c67689029d7856aac1065ec11',
        value: '0x0',
        data: '0x095ea7b300000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc450000000000000000000000000000000000000000000000e3bbe78839d3dea68069481369',
        from: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        gasPrice: '0x354c533c00',
        gas: '0x104240'
      },
      'latest',
      {
        tracer:
          "{data: [], fault: function (log) {}, step: function (log) { if (log.op.toString() === 'LOG3') { this.data.push([ toHex(log.contract.getAddress()), '0x' + ('0000000000000000000000000000000000000000' + log.stack.peek(4).toString(16)).slice(-40)])}}, result: function () { return this.data }}",
        enableMemory: false,
        enableReturnData: true,
        disableStorage: true
      }
    ])
    .catch((e: any) => {
      if (e.message.includes('no response')) {
        throw new Error('no response')
      }

      supportsDebugTraceCall = false
    })

  noThrottleProvider.destroy()
  return supportsDebugTraceCall
}
