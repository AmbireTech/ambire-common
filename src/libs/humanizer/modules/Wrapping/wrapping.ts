import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { WETH } from '../../const/abis'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import {
  getAction,
  getLabel,
  getToken,
  getUnknownVisualization,
  getUnwrapping,
  getWrapping
} from '../../utils'

const wrapSwapReducer = (calls: IrCall[]): IrCall[] => {
  const newCalls: IrCall[] = []
  let updated = false
  for (let i = 0; i < calls.length; i++) {
    if (
      // swapping x amount of token for y of WETH and unwrapping y WETH for y ETH
      calls[i]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Unwrap') &&
      calls[i + 1]?.fullVisualization?.[1].address &&
      calls[i]?.fullVisualization?.[3].amount === calls[i + 1]?.fullVisualization?.[1]?.amount
    ) {
      const newVisualization = calls[i]?.fullVisualization!
      newVisualization[3].address = ZeroAddress

      newCalls.push({
        to: calls[i].to,
        value: calls[i].value + calls[i + 1].value,
        // the unwrap call.data is omitted
        data: calls[i].data,
        fromUserRequestId: calls[i].fromUserRequestId,
        fullVisualization: newVisualization
      })
      i += 1
      updated = true
    } else if (
      calls[i]?.fullVisualization?.[0].content?.includes('Wrap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i].value === calls[i + 1]?.fullVisualization?.[1].amount &&
      calls[i + 1]?.fullVisualization?.[1].address
    ) {
      const newVisualization = calls[i + 1]?.fullVisualization!
      newVisualization[1].address = ZeroAddress
      newCalls.push({
        to: calls[i + 1].to,
        value: calls[i].value + calls[i + 1].value,
        // the wrap data is omitted
        data: calls[i + 1].data,
        fromUserRequestId: calls[i].fromUserRequestId,
        fullVisualization: newVisualization
      })
      i += 1
      updated = true
    } else if (
      calls[i]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i]?.fullVisualization?.[1]?.address &&
      calls[i + 1]?.fullVisualization?.[1]?.address &&
      calls[i]?.fullVisualization?.[3]?.address &&
      calls[i + 1]?.fullVisualization?.[3]?.address &&
      calls[i]?.fullVisualization?.[1]?.address === calls[i + 1]?.fullVisualization?.[1]?.address &&
      calls[i]?.fullVisualization?.[3]?.address === calls[i + 1]?.fullVisualization?.[3]?.address &&
      calls[i]?.fullVisualization?.[2]?.content?.startsWith('for')
    ) {
      const newVisualization = [
        getAction('Swap'),
        getToken(
          calls[i].fullVisualization![1].address!,
          calls[i].fullVisualization![1].amount! + calls[i + 1].fullVisualization![1].amount!
        ),
        getLabel(calls[i].fullVisualization![2].content!),
        getToken(
          calls[i].fullVisualization![3].address!,
          calls[i].fullVisualization![3].amount! + calls[i + 1].fullVisualization![3].amount!
        )
      ]
      newCalls.push({
        to: calls[i].to,
        value: calls[i].value + calls[i + 1].value,
        // second's call data is omitted
        data: calls[i].data,
        fromUserRequestId: calls[i].fromUserRequestId,
        fullVisualization: newVisualization
      })
      i += 1
      updated = true
    } else if (
      (calls[i]?.fullVisualization?.length || 0) >= 4 &&
      calls[i]?.fullVisualization?.[3]?.type === 'token' &&
      calls[i]?.fullVisualization?.[3]?.address &&
      calls[i]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i]?.fullVisualization?.[1]?.amount === calls[i].value &&
      calls[i]?.fullVisualization?.[1]?.amount === calls[i + 1]?.fullVisualization?.[1]?.amount &&
      // @NOTE: there is not check for swap's tokens
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Withdraw') &&
      calls[i + 1]?.fullVisualization?.[1]?.address === ZeroAddress
    ) {
      const newVisualization = [
        getAction('Swap'),
        getToken(ZeroAddress, calls[i].value),
        getLabel('for'),
        getToken(calls[i].fullVisualization![3].address!, calls[i].fullVisualization![3].amount!)
      ]
      newCalls.push({
        to: calls[i].to,
        value: calls[i].value + calls[i + 1].value,
        // second's call data is omitted
        data: calls[i].data,
        fromUserRequestId: calls[i].fromUserRequestId,
        fullVisualization: newVisualization
      })
      i += 1
      updated = true
    } else {
      newCalls.push(calls[i])
    }
  }
  return updated ? wrapSwapReducer(newCalls) : newCalls
}

export const wrappingModule: HumanizerCallModule = (
  _: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta
) => {
  const iface = new Interface(WETH)
  const newCalls = irCalls.map((call: IrCall) => {
    const knownAddressData = humanizerMeta?.knownAddresses[call.to.toLowerCase()]
    if (
      knownAddressData?.name === 'Wrapped ETH' ||
      knownAddressData?.name === 'WETH' ||
      knownAddressData?.token?.symbol === 'WETH' ||
      knownAddressData?.name === 'WMATIC' ||
      knownAddressData?.token?.symbol === 'WMATIC' ||
      knownAddressData?.token?.symbol === 'WAVAX'
    ) {
      // 0xd0e30db0
      if (call.data.slice(0, 10) === iface.getFunction('deposit')?.selector) {
        return {
          ...call,
          fullVisualization: getWrapping(ZeroAddress, call.value, call.to)
        }
      }
      // 0x2e1a7d4d
      if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
        const [amount] = iface.parseTransaction(call)?.args || []
        return {
          ...call,
          fullVisualization: getUnwrapping(ZeroAddress, amount, call.to)
        }
      }
      if (!call?.fullVisualization)
        return {
          ...call,
          fullVisualization: getUnknownVisualization('wrapped', call)
        }
    }
    return call
  })
  const parsedCalls = wrapSwapReducer(newCalls)
  return [parsedCalls, []]
}
