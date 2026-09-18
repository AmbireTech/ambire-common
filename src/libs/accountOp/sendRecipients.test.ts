import { encodeFunctionData, parseAbi } from 'viem'

import { describe, expect, test } from '@jest/globals'

import { getSendRecipients } from './sendRecipients'
import { Call } from './types'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NFT = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
const ALICE = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const BOB = '0x8f4B2F3e18a4E1Fc5c9d95e1eE5A9B37a55f6A67'
const ACCOUNT = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'

const call = (overrides: Partial<Call>): Call => ({ value: 0n, data: '0x', ...overrides })

const erc20 = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
])
const erc721 = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)'
])

describe('getSendRecipients', () => {
  test('returns the target of a native transfer', () => {
    expect(getSendRecipients([call({ to: ALICE, value: 1n })])).toEqual([ALICE])
  })

  test('ignores a zero value call with no data', () => {
    expect(getSendRecipients([call({ to: ALICE })])).toEqual([])
  })

  test('returns the recipient of an ERC20 transfer, not the token', () => {
    const data = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [ALICE, 10n] })

    expect(getSendRecipients([call({ to: USDC, data })])).toEqual([ALICE])
  })

  test('returns the `to` argument of transferFrom, not the `from`', () => {
    const data = encodeFunctionData({
      abi: erc20,
      functionName: 'transferFrom',
      args: [ACCOUNT, BOB, 10n]
    })

    expect(getSendRecipients([call({ to: USDC, data })])).toEqual([BOB])
  })

  test('handles both safeTransferFrom overloads', () => {
    const withoutData = encodeFunctionData({
      abi: erc721,
      functionName: 'safeTransferFrom',
      args: [ACCOUNT, ALICE, 1n]
    })
    const withData = encodeFunctionData({
      abi: erc721,
      functionName: 'safeTransferFrom',
      args: [ACCOUNT, BOB, 1n, '0x1234']
    })

    expect(getSendRecipients([call({ to: NFT, data: withoutData })])).toEqual([ALICE])
    expect(getSendRecipients([call({ to: NFT, data: withData })])).toEqual([BOB])
  })

  test('ignores contract interactions that are not sends', () => {
    const approve = encodeFunctionData({ abi: erc20, functionName: 'approve', args: [ALICE, 10n] })

    expect(getSendRecipients([call({ to: USDC, data: approve })])).toEqual([])
    expect(getSendRecipients([call({ to: USDC, data: '0x12345678deadbeef' })])).toEqual([])
  })

  test('ignores a payable contract call, because the target is not a recipient', () => {
    const approve = encodeFunctionData({ abi: erc20, functionName: 'approve', args: [ALICE, 10n] })

    expect(getSendRecipients([call({ to: USDC, data: approve, value: 1n })])).toEqual([])
  })

  test('does not throw on calldata that only looks like a transfer', () => {
    expect(getSendRecipients([call({ to: USDC, data: '0xa9059cbb00' })])).not.toBeUndefined()
  })

  test('dedupes recipients across a batch and checksums them', () => {
    const data = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [ALICE, 10n] })

    expect(
      getSendRecipients([
        call({ to: USDC, data }),
        call({ to: ALICE.toLowerCase(), value: 1n }),
        call({ to: BOB, value: 1n })
      ])
    ).toEqual([ALICE, BOB])
  })

  test('skips a contract deployment, which has no recipient', () => {
    expect(getSendRecipients([call({ data: '0x60806040', value: 0n })])).toEqual([])
  })
})
