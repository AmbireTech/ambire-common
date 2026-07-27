import { Interface, ZeroHash } from 'ethers'

import { expect, test } from '@jest/globals'

import { getMulticallBanners } from './nestedTokenApproval'

const token = '0x0bF0164D17469241B6E086dA4016DCc54FEAA334'
const owner = '0x3E1B8F98Ed69C6A97A8540E1D7AeD33FdF4509aA'
const spender = '0x0012b7C5D4310915bB2d58C0b14C72546D320C05'
const multicallInterface = new Interface(['function multicall(bytes[] data)'])

const asMulticall = (nestedCalls: string[]) => ({
  data: multicallInterface.encodeFunctionData('multicall', [nestedCalls])
})

const approvalCalls = [
  {
    name: 'ERC-20 approve',
    call: new Interface(['function approve(address spender, uint256 value)']).encodeFunctionData(
      'approve',
      [spender, 1n]
    )
  },
  {
    name: 'Permit2 approve',
    call: new Interface([
      'function approve(address token, address spender, uint160 amount, uint48 expiration)'
    ]).encodeFunctionData('approve', [token, spender, 1n, 1n])
  },
  {
    name: 'ERC-20 increaseAllowance',
    call: new Interface([
      'function increaseAllowance(address spender, uint256 addedValue)'
    ]).encodeFunctionData('increaseAllowance', [spender, 1n])
  },
  {
    name: 'legacy ERC-20 increaseApproval',
    call: new Interface([
      'function increaseApproval(address spender, uint256 addedValue)'
    ]).encodeFunctionData('increaseApproval', [spender, 1n])
  },
  {
    name: 'ERC-2612 permit',
    call: new Interface([
      'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)'
    ]).encodeFunctionData('permit', [owner, spender, 1n, 1n, 27, ZeroHash, ZeroHash])
  },
  {
    name: 'DAI-style permit',
    call: new Interface([
      'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
    ]).encodeFunctionData('permit', [owner, spender, 0n, 1n, true, 27, ZeroHash, ZeroHash])
  }
]

test.each(approvalCalls)('detects $name nested in multicall(bytes[])', ({ call }) => {
  expect(getMulticallBanners([asMulticall([call])])).toEqual([
    expect.objectContaining({ id: 'nested-token-approval-warning-banner' })
  ])
})

test('returns the nested token approval banner entry', () => {
  const transfer = new Interface([
    'function transfer(address recipient, uint256 value)'
  ]).encodeFunctionData('transfer', [spender, 1n])

  expect(getMulticallBanners([asMulticall([approvalCalls[0]!.call, transfer])])).toEqual([
    {
      id: 'nested-token-approval-warning-banner',
      type: 'warning',
      text: 'This multicall includes a token approval. Make sure you trust the spender and the amount before signing.'
    }
  ])
})

test('does not detect direct approvals or Safe MultiSend calls', () => {
  expect(getMulticallBanners([{ data: approvalCalls[0]!.call }])).toEqual([])
  expect(getMulticallBanners([{ data: '0x8d80ff0a' }])).toEqual([])
})

test('ignores revocations, no-op increases, and unrelated calls', () => {
  const approveInterface = new Interface(['function approve(address spender, uint256 value)'])
  const increaseAllowanceInterface = new Interface([
    'function increaseAllowance(address spender, uint256 addedValue)'
  ])
  const daiPermitInterface = new Interface([
    'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
  ])
  const transferInterface = new Interface(['function transfer(address recipient, uint256 value)'])

  expect(
    getMulticallBanners([
      asMulticall([
        approveInterface.encodeFunctionData('approve', [spender, 0n]),
        increaseAllowanceInterface.encodeFunctionData('increaseAllowance', [spender, 0n]),
        daiPermitInterface.encodeFunctionData('permit', [
          owner,
          spender,
          0n,
          1n,
          false,
          27,
          ZeroHash,
          ZeroHash
        ]),
        transferInterface.encodeFunctionData('transfer', [spender, 1n])
      ])
    ])
  ).toEqual([])
  expect(getMulticallBanners([asMulticall([])])).toEqual([])
})

test('returns a separate warning for malformed multicall arguments', () => {
  const malformedMulticall = { data: '0xac9650d8' }

  expect(getMulticallBanners([malformedMulticall])).toEqual([
    {
      id: 'malformed-multicall-warning-banner',
      type: 'warning',
      text: "We couldn't inspect the actions inside this multicall. Proceed only if you trust the app."
    }
  ])
})

test('returns both banners for separate approval and malformed multicalls', () => {
  expect(
    getMulticallBanners([asMulticall([approvalCalls[0]!.call]), { data: '0xac9650d8' }])
  ).toEqual([
    expect.objectContaining({ id: 'nested-token-approval-warning-banner' }),
    expect.objectContaining({ id: 'malformed-multicall-warning-banner' })
  ])
})
