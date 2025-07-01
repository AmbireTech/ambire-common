import { Interface, isAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { registeredCoinTypes } from '../../const/coinType'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

const ENS_CONTROLLER = '0x253553366Da8546fC250F225fe3d25d0C782303b'
const ENS_RESOLVER = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63'
const BULK_RENEWAL = '0xa12159e5131b1eEf6B4857EEE3e1954744b5033A'

const iface = new Interface([
  'function register(string name,address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses)',
  'function commit(bytes32)',
  'function setText(bytes32 node,string calldata key,string calldata value)',
  'function multicall(bytes[] data)',
  // 'function setAddr(bytes32,uint256,bytes)',
  'function setAddr(bytes32 node, uint256 coinType, bytes memory a)',
  'function setContenthash(bytes32,bytes)',
  'function setABI(bytes32,uint256,bytes)',
  'function renew(string id,uint256 duration)',
  'function renewAll(string[] calldata names, uint256 duration)'
])

const YEAR_IN_SECONDS = 60n * 60n * 24n * 365n
const getDurationText = (duration: bigint): string => {
  const durationLabel = `${duration / YEAR_IN_SECONDS} year${
    duration < 2n * YEAR_IN_SECONDS ? '' : 's'
  }`
  return durationLabel
}

export const ensModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  // @TODO: set text and others
  return irCalls.map((call) => {
    if (call.to && call.to.toLowerCase() === ENS_CONTROLLER.toLowerCase()) {
      if (call.data.slice(0, 10) === iface.getFunction('register')!.selector) {
        const {
          name,
          owner,
          duration
          // secret,
          // resolver,
          // data,
          // reverseRecord,
          // ownerControlledFuses
        } = iface.decodeFunctionData('register', call.data)
        const fullVisualization = [getAction('Register'), getLabel(`${name}.ens`, true)]

        if (owner !== accountOp.accountAddr)
          fullVisualization.push(getLabel('to'), getAddressVisualization(owner))
        const durationLabel = getDurationText(duration)

        fullVisualization.push(getLabel('for'), getLabel(durationLabel, true))

        return { ...call, fullVisualization }
      }

      if (call.data.slice(0, 10) === iface.getFunction('renew')!.selector) {
        const { id, duration } = iface.decodeFunctionData('renew', call.data)
        const durationLabel = getDurationText(duration)
        const fullVisualization = [
          getAction('Renew'),
          getLabel(`${id}.eth`),
          getLabel('for'),
          getLabel(durationLabel, true)
        ]

        return { ...call, fullVisualization }
      }

      if (call.data.slice(0, 10) === iface.getFunction('commit')!.selector) {
        return {
          ...call,
          fullVisualization: [getAction('Request'), getLabel('to register an ENS record')]
        }
      }
    }
    const resolverMatcher = {
      [iface.getFunction('setText')!.selector]: (data: string) => {
        const {
          // node,
          key,
          value
        } = iface.decodeFunctionData('setText', data)
        return [getAction('Set'), getLabel(`${key} to`), getLabel(value, true)]
      },
      [iface.getFunction('setAddr')!.selector]: (data: string) => {
        const {
          // node,
          coinType,
          a
        } = iface.decodeFunctionData('setAddr', data)
        const ct = registeredCoinTypes[Number(coinType)]
        const networkName = (ct && ct[2]) || 'Unknown network'
        return networkName === 'Ether'
          ? [
              getAction('Transfer ENS'),
              getLabel('to'),
              isAddress(a) ? getAddressVisualization(a) : getLabel(a, true)
            ]
          : [
              getAction('Set'),
              getLabel('address'),
              isAddress(a) ? getAddressVisualization(a) : getLabel(a, true),
              getLabel('on'),
              getLabel(networkName, true)
            ]
      },
      [iface.getFunction('setContenthash')!.selector]: () => {
        return [getAction('Update'), getLabel('data')]
      },
      [iface.getFunction('setABI')!.selector]: () => {
        return [getAction('Set'), getLabel('ABI')]
      }
    }

    if (call.to && call.to.toLowerCase() === ENS_RESOLVER.toLowerCase()) {
      if (resolverMatcher[call.data.slice(0, 10)])
        return { ...call, fullVisualization: resolverMatcher[call.data.slice(0, 10)](call.data) }

      if (call.data.slice(0, 10) === iface.getFunction('multicall')!.selector) {
        const { data } = iface.decodeFunctionData('multicall', call.data)
        const separator = getLabel('and')
        const fullVisualization = data
          .map((i: string): HumanizerVisualization[] => {
            return resolverMatcher[i.slice(0, 10)]
              ? resolverMatcher[i.slice(0, 10)](i)
              : [getAction('Unknown ENS action')]
          })
          .reduce(
            (acc: HumanizerVisualization[], curr: HumanizerVisualization[], index: number) =>
              acc.concat(index ? [separator, ...curr] : curr),
            []
          )
        return { ...call, fullVisualization }
      }
    }
    if (
      call.to &&
      call.to.toLowerCase() === BULK_RENEWAL.toLowerCase() &&
      call.data.startsWith(iface.getFunction('renewAll')!.selector)
    ) {
      const { names, duration } = iface.decodeFunctionData('renewAll', call.data)
      const durationLabel = getDurationText(duration)

      return {
        ...call,
        fullVisualization: [
          getAction('Renew'),
          ...names.map((name: string) => getLabel(`${name}.eth`, true)),
          getLabel('for'),
          getLabel(durationLabel, true)
        ]
      }
    }
    return call
  })
}
