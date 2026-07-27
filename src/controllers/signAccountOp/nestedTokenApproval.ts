import { Interface } from 'ethers'

import { SignAccountOpBanner } from '../../interfaces/signAccountOp'
import { Call } from '../../libs/accountOp/types'

const multicallInterface = new Interface(['function multicall(bytes[] data)'])
const erc20ApproveInterface = new Interface(['function approve(address spender, uint256 value)'])
const permit2ApproveInterface = new Interface([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
])
const increaseAllowanceInterface = new Interface([
  'function increaseAllowance(address spender, uint256 addedValue)'
])
const increaseApprovalInterface = new Interface([
  'function increaseApproval(address spender, uint256 addedValue)'
])
const erc2612PermitInterface = new Interface([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)'
])
const daiPermitInterface = new Interface([
  'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
])

const MULTICALL_SELECTOR = multicallInterface.getFunction('multicall')!.selector
const ERC20_APPROVE_SELECTOR = erc20ApproveInterface.getFunction('approve')!.selector
const PERMIT2_APPROVE_SELECTOR = permit2ApproveInterface.getFunction('approve')!.selector
const INCREASE_ALLOWANCE_SELECTOR =
  increaseAllowanceInterface.getFunction('increaseAllowance')!.selector
const INCREASE_APPROVAL_SELECTOR =
  increaseApprovalInterface.getFunction('increaseApproval')!.selector
const ERC2612_PERMIT_SELECTOR = erc2612PermitInterface.getFunction('permit')!.selector
const DAI_PERMIT_SELECTOR = daiPermitInterface.getFunction('permit')!.selector

type MulticallInspection =
  | { type: 'not-multicall' | 'malformed' }
  | { type: 'decoded'; nestedCalls: readonly string[] }

const inspectMulticall = (call: Pick<Call, 'data'>): MulticallInspection => {
  if (!call.data || call.data.slice(0, 10).toLowerCase() !== MULTICALL_SELECTOR)
    return { type: 'not-multicall' }

  try {
    const [nestedCalls] = multicallInterface.decodeFunctionData('multicall', call.data)

    return { type: 'decoded', nestedCalls }
  } catch {
    return { type: 'malformed' }
  }
}

const grantsTokenApproval = (data: string): boolean => {
  const selector = data.slice(0, 10).toLowerCase()

  try {
    if (selector === ERC20_APPROVE_SELECTOR) {
      const [, value] = erc20ApproveInterface.decodeFunctionData('approve', data)
      return value > 0n
    }

    if (selector === PERMIT2_APPROVE_SELECTOR) {
      const [, , amount] = permit2ApproveInterface.decodeFunctionData('approve', data)
      return amount > 0n
    }

    if (selector === INCREASE_ALLOWANCE_SELECTOR) {
      const [, addedValue] = increaseAllowanceInterface.decodeFunctionData(
        'increaseAllowance',
        data
      )
      return addedValue > 0n
    }

    if (selector === INCREASE_APPROVAL_SELECTOR) {
      const [, addedValue] = increaseApprovalInterface.decodeFunctionData('increaseApproval', data)
      return addedValue > 0n
    }

    if (selector === ERC2612_PERMIT_SELECTOR) {
      const [, , value] = erc2612PermitInterface.decodeFunctionData('permit', data)
      return value > 0n
    }

    if (selector === DAI_PERMIT_SELECTOR) {
      const [, , , , allowed] = daiPermitInterface.decodeFunctionData('permit', data)
      return allowed
    }
  } catch {
    return false
  }

  return false
}

export const getMulticallBanners = (calls: Pick<Call, 'data'>[]): SignAccountOpBanner[] => {
  let hasNestedTokenApproval = false
  let hasMalformedMulticall = false

  for (const call of calls) {
    const inspection = inspectMulticall(call)
    if (inspection.type === 'malformed') hasMalformedMulticall = true
    if (inspection.type === 'decoded' && inspection.nestedCalls.some(grantsTokenApproval)) {
      hasNestedTokenApproval = true
    }

    if (hasNestedTokenApproval && hasMalformedMulticall) break
  }

  const banners: SignAccountOpBanner[] = []

  if (hasNestedTokenApproval) {
    banners.push({
      id: 'nested-token-approval-warning-banner',
      type: 'warning',
      text: 'This multicall includes a token approval. Make sure you trust the spender and the amount before signing.'
    })
  }

  if (hasMalformedMulticall) {
    banners.push({
      id: 'malformed-multicall-warning-banner',
      type: 'warning',
      text: "We couldn't inspect the actions inside this multicall. Proceed only if you trust the app."
    })
  }

  return banners
}
