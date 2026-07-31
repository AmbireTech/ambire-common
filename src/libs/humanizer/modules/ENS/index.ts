import { decodeFunctionData, isAddress, parseAbi, toFunctionSelector, type Hex } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { registeredCoinTypes } from '../../const/coinType'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, isHexCall } from '../../utils'

const ENS_CONTROLLER = '0x253553366Da8546fC250F225fe3d25d0C782303b'
const ENS_RESOLVER = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63'
const BULK_RENEWAL = '0xa12159e5131b1eEf6B4857EEE3e1954744b5033A'

const registerAbi = parseAbi([
  'function register(string name,address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses)'
])
const commitAbi = parseAbi(['function commit(bytes32)'])
const setTextAbi = parseAbi([
  'function setText(bytes32 node,string calldata key,string calldata value)'
])
const multicallAbi = parseAbi(['function multicall(bytes[] data)'])
const setAddrAbi = parseAbi(['function setAddr(bytes32 node, uint256 coinType, bytes memory a)'])
const setContenthashAbi = parseAbi(['function setContenthash(bytes32,bytes)'])
const setABIAbi = parseAbi(['function setABI(bytes32,uint256,bytes)'])
const renewAbi = parseAbi(['function renew(string id,uint256 duration)'])
const renewAllAbi = parseAbi(['function renewAll(string[] calldata names, uint256 duration)'])

const YEAR_IN_SECONDS = 60n * 60n * 24n * 365n
const getDurationText = (duration: bigint): string => {
  const durationLabel = `${duration / YEAR_IN_SECONDS} year${
    duration < 2n * YEAR_IN_SECONDS ? '' : 's'
  }`
  return durationLabel
}

export const ensModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  // @TODO: set text and others
  if (!isHexCall(call)) return call

  if (call.to && call.to.toLowerCase() === ENS_CONTROLLER.toLowerCase()) {
    if (call.data.slice(0, 10) === toFunctionSelector(registerAbi[0])) {
      const { args } = decodeFunctionData({ abi: registerAbi, data: call.data })
      const [name, owner, duration] = args
      const fullVisualization = [getAction('Register'), getLabel(`${name}.ens`, true)]

      if (owner !== accountOp.accountAddr)
        fullVisualization.push(getLabel('to'), getAddressVisualization(owner))
      const durationLabel = getDurationText(duration)

      fullVisualization.push(getLabel('for'), getLabel(durationLabel, true))

      return { ...call, fullVisualization }
    }

    if (call.data.slice(0, 10) === toFunctionSelector(renewAbi[0])) {
      const { args } = decodeFunctionData({ abi: renewAbi, data: call.data })
      const [id, duration] = args
      const durationLabel = getDurationText(duration)
      const fullVisualization = [
        getAction('Renew'),
        getLabel(`${id}.eth`),
        getLabel('for'),
        getLabel(durationLabel, true)
      ]

      return { ...call, fullVisualization }
    }

    if (call.data.slice(0, 10) === toFunctionSelector(commitAbi[0])) {
      return {
        ...call,
        fullVisualization: [getAction('Request'), getLabel('to register an ENS record')]
      }
    }
  }
  const resolverMatcher: Record<string, (data: Hex) => HumanizerVisualization[]> = {
    [toFunctionSelector(setTextAbi[0])]: (data) => {
      const { args } = decodeFunctionData({ abi: setTextAbi, data })
      const [, key, value] = args
      return [getAction('Set'), getLabel(`${key} to`), getLabel(value, true)]
    },
    [toFunctionSelector(setAddrAbi[0])]: (data) => {
      const { args } = decodeFunctionData({ abi: setAddrAbi, data })
      const [, coinType, a] = args
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
    [toFunctionSelector(setContenthashAbi[0])]: () => {
      return [getAction('Update'), getLabel('data')]
    },
    [toFunctionSelector(setABIAbi[0])]: () => {
      return [getAction('Set'), getLabel('ABI')]
    }
  }

  if (call.to && call.to.toLowerCase() === ENS_RESOLVER.toLowerCase()) {
    const resolverHandler = resolverMatcher[call.data.slice(0, 10)]
    if (resolverHandler) return { ...call, fullVisualization: resolverHandler(call.data) }

    if (call.data.slice(0, 10) === toFunctionSelector(multicallAbi[0])) {
      const { args } = decodeFunctionData({ abi: multicallAbi, data: call.data })
      const [data] = args
      const separator = getLabel('and')
      const fullVisualization = data
        .map((i): HumanizerVisualization[] => {
          const handler = resolverMatcher[i.slice(0, 10)]
          return handler ? handler(i) : [getAction('Unknown ENS action')]
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
    call.data.startsWith(toFunctionSelector(renewAllAbi[0]))
  ) {
    const { args } = decodeFunctionData({ abi: renewAllAbi, data: call.data })
    const [names, duration] = args
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
}
