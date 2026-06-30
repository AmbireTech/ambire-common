import { decodeFunctionData, getAddress, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getLabel,
  getToken,
  getWarning,
  HexIrCall,
  isHexCall
} from '../../utils'

// Narrowed ABIs — defined once at module level, used for typed decoding
const erc721ApproveAbi = parseAbi(['function approve(address to, uint256 tokenId)'])
const erc721SetApprovalForAllAbi = parseAbi([
  'function setApprovalForAll(address operator, bool approved)'
])
const erc721SafeTransferFromAbi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)'
])
const erc721TransferFromAbi = parseAbi([
  'function transferFrom(address from, address to, uint256 tokenId)'
])

const erc20ApproveAbi = parseAbi([
  'function approve(address _spender, uint256 _value) returns (bool)'
])
const erc20TransferAbi = parseAbi(['function transfer(address _to, uint256 _value) returns (bool)'])
const erc20TransferFromAbi = parseAbi([
  'function transferFrom(address _from, address _to, uint256 _value) returns (bool)'
])
const erc20IncreaseAllowanceAbi = parseAbi([
  'function increaseAllowance(address spender, uint256 addedValue) returns (bool)'
])
const erc20IncreaseApprovalAbi = parseAbi([
  'function increaseApproval(address spender, uint256 addedValue) returns (bool)'
])
const erc20DecreaseAllowanceAbi = parseAbi([
  'function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)'
])
const erc20DecreaseApprovalAbi = parseAbi([
  'function decreaseApproval(address spender, uint256 subtractedValue) returns (bool)'
])

const WORD_HEX_LENGTH = 64
const SELECTOR_HEX_LENGTH = 10
const ADDRESS_AMOUNT_ARGS_HEX_LENGTH = WORD_HEX_LENGTH * 2
const INVALID_TRANSACTION_DATA_WARNING = getWarning(
  'Transaction data seems invalid. Please review it carefully',
  'TRANSACTION_DATA_INVALID'
)

const getStaticCallWord = (data: HexIrCall['data'], index: number): string => {
  const start = SELECTOR_HEX_LENGTH + index * WORD_HEX_LENGTH
  const end = start + WORD_HEX_LENGTH

  return data.slice(start, end).padEnd(WORD_HEX_LENGTH, '0')
}

const getAddressAndAmountArgs = (data: HexIrCall['data']): [string, bigint] => {
  const addressWord = getStaticCallWord(data, 0)
  const amountWord = getStaticCallWord(data, 1)

  return [getAddress(`0x${addressWord.slice(-40)}`), BigInt(`0x${amountWord}`)]
}

const isAddressAndAmountArgsTruncated = (data: HexIrCall['data']): boolean =>
  data.length < SELECTOR_HEX_LENGTH + ADDRESS_AMOUNT_ARGS_HEX_LENGTH

export const genericErc721Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const nftTransferVisualization = (
    call: HexIrCall,
    abi: typeof erc721SafeTransferFromAbi | typeof erc721TransferFromAbi
  ) => {
    if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
    const { args } = decodeFunctionData({ abi, data: call.data })
    const [from, to, tokenId] = args
    return from === accountOp.accountAddr
      ? [getAction('Send'), getToken(call.to, tokenId), getLabel('to'), getAddressVisualization(to)]
      : [
          getAction('Transfer'),
          getToken(call.to, tokenId),
          getLabel('from'),
          getAddressVisualization(from),
          getLabel('to'),
          getAddressVisualization(to)
        ]
  }

  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(erc721ApproveAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({ abi: erc721ApproveAbi, data: call.data })
      const [to, tokenId] = args
      return to === zeroAddress
        ? [getAction('Revoke approval'), getLabel('for'), getToken(call.to, tokenId)]
        : [
            getAction('Grant approval'),
            getLabel('for'),
            getToken(call.to, tokenId),
            getLabel('to'),
            getAddressVisualization(to)
          ]
    },
    [toFunctionSelector(erc721SetApprovalForAllAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc721SetApprovalForAllAbi,
        data: call.data
      })
      const [operator, approved] = args
      return approved
        ? [
            getAction('Grant approval', { warning: true }),
            getLabel('for all NFTs of'),
            getAddressVisualization(call.to),
            getLabel('to'),
            getAddressVisualization(operator)
          ]
        : [
            getAction('Revoke approval'),
            getLabel('for all nfts from'),
            getAddressVisualization(call.to),
            getLabel('for'),
            getAddressVisualization(operator)
          ]
    },
    [toFunctionSelector(erc721SafeTransferFromAbi[0])]: (call) =>
      nftTransferVisualization(call, erc721SafeTransferFromAbi),
    [toFunctionSelector(erc721TransferFromAbi[0])]: (call) =>
      nftTransferVisualization(call, erc721TransferFromAbi)
  }

  return currentIrCalls.map((call) => {
    if (!call.to) return call
    if (!isHexCall(call)) return call
    const selector = call.data.substring(0, 10)
    return matcher[selector] ? { ...call, fullVisualization: matcher[selector](call) } : call
  })
}

export const genericErc20Humanizer = (
  { accountAddr }: { accountAddr: string },
  currentIrCalls: IrCall[]
): IrCall[] => {
  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(erc20ApproveAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const [spender, value] = getAddressAndAmountArgs(call.data)
      return value !== 0n
        ? [
            getAction('Grant approval'),
            getLabel('for'),
            getToken(call.to, value),
            getLabel('to'),
            getAddressVisualization(spender)
          ]
        : [
            getAction('Revoke approval'),
            getToken(call.to, value),
            getLabel('for'),
            getAddressVisualization(spender)
          ]
    },
    [toFunctionSelector(erc20IncreaseAllowanceAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const [spender, addedValue] = getAddressAndAmountArgs(call.data)
      return [
        getAction('Increase allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(call.to, addedValue)
      ]
    },
    [toFunctionSelector(erc20IncreaseApprovalAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const [spender, addedValue] = getAddressAndAmountArgs(call.data)
      return [
        getAction('IncreaseApproval'),
        getLabel('with'),
        getToken(call.to, addedValue),
        getLabel('to'),
        getAddressVisualization(spender)
      ]
    },
    [toFunctionSelector(erc20DecreaseAllowanceAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const [spender, subtractedValue] = getAddressAndAmountArgs(call.data)
      return [
        getAction('Decrease allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(call.to, subtractedValue)
      ]
    },
    [toFunctionSelector(erc20DecreaseApprovalAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const [spender, subtractedValue] = getAddressAndAmountArgs(call.data)
      return [
        getAction('DecreaseApproval'),
        getLabel('with'),
        getToken(call.to, subtractedValue),
        getLabel('to'),
        getAddressVisualization(spender)
      ]
    },
    [toFunctionSelector(erc20TransferAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({ abi: erc20TransferAbi, data: call.data })
      const [to, value] = args
      return [
        getAction('Send'),
        getToken(call.to, value),
        getLabel('to'),
        getAddressVisualization(to)
      ]
    },
    [toFunctionSelector(erc20TransferFromAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({ abi: erc20TransferFromAbi, data: call.data })
      const [from, to, value] = args
      if (from === accountAddr)
        return [
          getAction('Transfer'),
          getToken(call.to, value),
          getLabel('to'),
          getAddressVisualization(to)
        ]
      if (to === accountAddr)
        return [
          getAction('Take'),
          getToken(call.to, value),
          getLabel('from'),
          getAddressVisualization(from)
        ]
      return [
        getAction('Move'),
        getToken(call.to, value),
        getLabel('from'),
        getAddressVisualization(from),
        getLabel('to'),
        getAddressVisualization(to)
      ]
    }
  }

  return currentIrCalls.map((call) => {
    if (!call.to) return call
    if (!isHexCall(call)) return call
    const sigHash = call.data.substring(0, 10)
    if (!matcher[sigHash]) return call

    const fullVisualization = matcher[sigHash](call)
    const warnings = isAddressAndAmountArgsTruncated(call.data)
      ? [...(call.warnings || []), INVALID_TRANSACTION_DATA_WARNING]
      : call.warnings

    return { ...call, fullVisualization, warnings }
  })
}
