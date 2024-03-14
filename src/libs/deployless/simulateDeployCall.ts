import { JsonRpcProvider, ZeroAddress } from 'ethers'

import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
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
  const deployless = fromDescriptor(provider, AmbireAccountFactory, true)
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
      // if there's an error, return the zero address indicating that
      // our smart accounts will most likely not work on this chain
      supportsStateOverride = !e.info.error.message.includes('too many arguments')
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

  await provider
    .send('debug_traceCall', [
      {
        to: DEPLOYLESS_SIMULATION_FROM,
        value: '0x01',
        data: '0x',
        from: ZeroAddress,
        gasPrice: '0x104240',
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
      if (
        e.message.includes('not whitelisted') ||
        e.message.includes('not exist') ||
        e.message.includes("doesn't exist") ||
        e.message.includes('not available') ||
        e.code === 'UNSUPPORTED_OPERATION'
      ) {
        supportsDebugTraceCall = false
      }
    })

  return supportsDebugTraceCall
}
