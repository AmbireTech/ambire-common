import { parseAbi, decodeFunctionData, toFunctionSelector, zeroAddress, Hex } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getLabel,
  getToken,
  getUnlimitedApprovalWarning,
  getWarning,
  isHexCall,
  isUnlimitedAmount,
  mergeWarnings,
  UNLIMITED_APPROVAL_WARNING_CODE
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
const erc20DecreaseAllowanceAbi = parseAbi([
  'function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)'
])
// legacy naming used by some tokens (e.g. OMG) instead of increaseAllowance/decreaseAllowance
const erc20IncreaseApprovalAbi = parseAbi([
  'function increaseApproval(address _spender, uint256 _addedValue) returns (bool)'
])
const erc20DecreaseApprovalAbi = parseAbi([
  'function decreaseApproval(address _spender, uint256 _subtractedValue) returns (bool)'
])

// tokens before solidity 0.5.0 would accept calldata that is shorter then the specified
// args in the abi and assume they are 0s
// other tokens fail onchain, so there is no real danger in padding to the end
// as long as it is kept in the humanizer
// applicable only to functions whose args are all static (one 32 byte word each)
const padCallData = (data: Hex, staticArgsCount: number): Hex => {
  const expectedCallLength = 2 + 8 + staticArgsCount * 64
  return data.padEnd(expectedCallLength, '0') as Hex
}

/**
 * What a matcher returns for one call: how to show it, plus a warning when the call turns out to
 * be an approval with no limit. The warning is built while the call is decoded, so the amount and
 * the spender are read only once.
 */
type DecodedCall = { visualizations: HumanizerVisualization[]; warning?: HumanizerWarning }

export const genericErc721Humanizer: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const nftTransferVisualization = (
    call: HexIrCall,
    abi: typeof erc721SafeTransferFromAbi | typeof erc721TransferFromAbi
  ): HumanizerVisualization[] => {
    if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
    const { args } = decodeFunctionData({ abi, data: padCallData(call.data, 3) })
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

  const matcher: Record<string, (call: HexIrCall) => DecodedCall> = {
    [toFunctionSelector(erc721ApproveAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc721ApproveAbi,
        data: padCallData(call.data, 2)
      })
      const [to, tokenId] = args
      return {
        visualizations:
          to === zeroAddress
            ? [getAction('Revoke approval'), getLabel('for'), getToken(call.to, tokenId)]
            : [
                getAction('Grant approval'),
                getLabel('for'),
                getToken(call.to, tokenId),
                getLabel('to'),
                getAddressVisualization(to)
              ]
      }
    },
    [toFunctionSelector(erc721SetApprovalForAllAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc721SetApprovalForAllAbi,
        data: padCallData(call.data, 2)
      })
      const [operator, approved] = args
      if (!approved)
        return {
          visualizations: [
            getAction('Revoke approval'),
            getLabel('for all nfts from'),
            getAddressVisualization(call.to),
            getLabel('for'),
            getAddressVisualization(operator)
          ]
        }

      return {
        visualizations: [
          getAction('Grant approval', { warning: true }),
          getLabel('for all NFTs of'),
          getAddressVisualization(call.to),
          getLabel('to'),
          getAddressVisualization(operator)
        ],
        // there is no amount to check here - granting this hands over every item in the
        // collection, including items bought later, until it is revoked
        warning: getWarning(
          'This app can transfer any item you own from this collection, now or later. Continue only if you trust it.',
          UNLIMITED_APPROVAL_WARNING_CODE,
          false,
          operator.toLowerCase()
        )
      }
    },
    [toFunctionSelector(erc721SafeTransferFromAbi[0])]: (call) => ({
      visualizations: nftTransferVisualization(call, erc721SafeTransferFromAbi)
    }),
    [toFunctionSelector(erc721TransferFromAbi[0])]: (call) => ({
      visualizations: nftTransferVisualization(call, erc721TransferFromAbi)
    })
  }

  if (!call.to) return call
  if (!isHexCall(call)) return call
  const selector = call.data.substring(0, 10)
  if (!matcher[selector]) return call

  const { visualizations, warning } = matcher[selector](call)

  return {
    ...call,
    fullVisualization: visualizations,
    warnings: mergeWarnings(call.warnings, warning ? [warning] : [])
  }
}

export const genericErc20Humanizer = (
  { accountAddr }: { accountAddr: string },
  call: IrCall
): IrCall => {
  // `increaseApproval` is the pre-final-EIP-20 spelling of `increaseAllowance` that some tokens
  // still use. Both raise the allowance by the amount given, so the same limit check fits each.
  const grantVisualizations = (token: string, spender: string, addedValue: bigint) => [
    getAction('Increase allowance'),
    getLabel('of'),
    getAddressVisualization(spender),
    getLabel('with'),
    getToken(token, addedValue)
  ]
  const revokeVisualizations = (token: string, spender: string, subtractedValue: bigint) => [
    getAction('Decrease allowance'),
    getLabel('of'),
    getAddressVisualization(spender),
    getLabel('with'),
    getToken(token, subtractedValue)
  ]

  const matcher: Record<string, (call: HexIrCall) => DecodedCall> = {
    [toFunctionSelector(erc20ApproveAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')

      const { args } = decodeFunctionData({
        abi: erc20ApproveAbi,
        data: padCallData(call.data, 2)
      })
      const [spender, value] = args
      if (value === 0n)
        return {
          visualizations: [
            getAction('Revoke approval'),
            getToken(call.to, value),
            getLabel('for'),
            getAddressVisualization(spender)
          ]
        }

      return {
        visualizations: [
          getAction('Grant approval'),
          getLabel('for'),
          getToken(call.to, value),
          getLabel('to'),
          getAddressVisualization(spender)
        ],
        warning: isUnlimitedAmount(value) ? getUnlimitedApprovalWarning(spender) : undefined
      }
    },
    [toFunctionSelector(erc20IncreaseAllowanceAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc20IncreaseAllowanceAbi,
        data: padCallData(call.data, 2)
      })
      const [spender, addedValue] = args
      return {
        visualizations: grantVisualizations(call.to, spender, addedValue),
        warning: isUnlimitedAmount(addedValue) ? getUnlimitedApprovalWarning(spender) : undefined
      }
    },
    [toFunctionSelector(erc20DecreaseAllowanceAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc20DecreaseAllowanceAbi,
        data: padCallData(call.data, 2)
      })
      const [spender, subtractedValue] = args
      return { visualizations: revokeVisualizations(call.to, spender, subtractedValue) }
    },
    [toFunctionSelector(erc20IncreaseApprovalAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc20IncreaseApprovalAbi,
        data: padCallData(call.data, 2)
      })
      const [spender, addedValue] = args
      return {
        visualizations: grantVisualizations(call.to, spender, addedValue),
        warning: isUnlimitedAmount(addedValue) ? getUnlimitedApprovalWarning(spender) : undefined
      }
    },
    [toFunctionSelector(erc20DecreaseApprovalAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc20DecreaseApprovalAbi,
        data: padCallData(call.data, 2)
      })
      const [spender, subtractedValue] = args
      return { visualizations: revokeVisualizations(call.to, spender, subtractedValue) }
    },
    [toFunctionSelector(erc20TransferAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc20TransferAbi,
        data: padCallData(call.data, 2)
      })
      const [to, value] = args
      return {
        visualizations: [
          getAction('Send'),
          getToken(call.to, value),
          getLabel('to'),
          getAddressVisualization(to)
        ]
      }
    },
    [toFunctionSelector(erc20TransferFromAbi[0])]: (call) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { args } = decodeFunctionData({
        abi: erc20TransferFromAbi,
        data: padCallData(call.data, 3)
      })
      const [from, to, value] = args
      if (from === accountAddr)
        return {
          visualizations: [
            getAction('Transfer'),
            getToken(call.to, value),
            getLabel('to'),
            getAddressVisualization(to)
          ]
        }
      if (to === accountAddr)
        return {
          visualizations: [
            getAction('Take'),
            getToken(call.to, value),
            getLabel('from'),
            getAddressVisualization(from)
          ]
        }
      return {
        visualizations: [
          getAction('Move'),
          getToken(call.to, value),
          getLabel('from'),
          getAddressVisualization(from),
          getLabel('to'),
          getAddressVisualization(to)
        ]
      }
    }
  }

  if (!call.to) return call
  if (!isHexCall(call)) return call
  const sigHash = call.data.substring(0, 10)
  if (!matcher[sigHash]) return call

  const { visualizations, warning } = matcher[sigHash](call)

  return {
    ...call,
    fullVisualization: visualizations,
    warnings: mergeWarnings(call.warnings, warning ? [warning] : [])
  }
}
