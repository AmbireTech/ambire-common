import { encodeFunctionData, parseAbi } from 'viem'

import {
  getAccountOpRecipients,
  getSubmittedAccountOpNonce,
  SubmittedAccountOp
} from './submittedAccountOp'
import { Call } from './types'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NFT = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
const ALICE = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const BOB = '0x8f4B2F3e18a4E1Fc5c9d95e1eE5A9B37a55f6A67'
const ACCOUNT = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'

const erc20 = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
])
const erc721 = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)'
])

describe('SubmittedAccountOp', () => {
  describe('getSubmittedAccountOpNonce', () => {
    const userOperationNonce = 1n << 192n

    test('keeps the Safe transaction nonce when the broadcast uses a UserOperation nonce', () => {
      expect(getSubmittedAccountOpNonce(30n, userOperationNonce, true)).toBe(30n)
    })

    test('keeps using the broadcast nonce for non-Safe transactions', () => {
      expect(getSubmittedAccountOpNonce(30n, userOperationNonce, false)).toBe(userOperationNonce)
    })

    test('falls back to the broadcast nonce when a Safe transaction nonce is unavailable', () => {
      expect(getSubmittedAccountOpNonce(null, 7, true)).toBe(7n)
    })
  })

  describe('getAccountOpRecipients', () => {
    const op = {
      accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      chainId: 1n,
      calls: [
        {
          data: '0xa9059cbb00000000000000000000000053289fa7aa588434dc3e9f584c89b3eb9352db5c0000000000000000000000000000000000000000000000000000000000007530',
          to: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
          value: 0n
        }
      ]
    } as SubmittedAccountOp

    const call = (overrides: Partial<Call>): Call => ({ value: 0n, data: '0x', ...overrides })
    const addressesOf = (calls: Call[]) =>
      getAccountOpRecipients({ calls }).map(({ address }) => address)

    test('should return the recipient of a transfer, not the token contract', () => {
      const recipients = getAccountOpRecipients(op)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('should filter recipients based on whitelist', () => {
      const whitelist = ['0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C']
      const recipients = getAccountOpRecipients(op, whitelist)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('whitelist is not case-sensitive', () => {
      const whitelist = ['0x53289fa7aa588434dc3e9f584c89b3eb9352db5c']
      const recipients = getAccountOpRecipients(op, whitelist)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('should return nothing when no recipient is whitelisted', () => {
      expect(getAccountOpRecipients(op, [ALICE])).toEqual([])
    })
    test('same address in multiple calls should appear only once', () => {
      const opWithDuplicates = {
        ...op,
        calls: [
          ...op.calls,
          ...op.calls // duplicate calls
        ]
      } as SubmittedAccountOp

      const recipients = getAccountOpRecipients(opWithDuplicates)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('should include recipientDomain when present on a call', () => {
      const opWithDomain = {
        ...op,
        calls: [{ ...op.calls[0], recipientDomain: ' Sample.ETH ' }]
      } as SubmittedAccountOp

      const recipients = getAccountOpRecipients(opWithDomain)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: 'sample.eth' }
      ])
    })
    test('keeps a known domain when a later call to the same recipient has none', () => {
      const recipients = getAccountOpRecipients({
        calls: [
          call({ to: ALICE, value: 1n, recipientDomain: 'alice.eth' }),
          call({ to: ALICE, value: 1n })
        ]
      })

      expect(recipients).toEqual([{ address: ALICE, domain: 'alice.eth' }])
    })
    test('returns the target of a native transfer', () => {
      expect(addressesOf([call({ to: ALICE, value: 1n })])).toEqual([ALICE])
    })

    test('ignores a zero value call with no data', () => {
      expect(addressesOf([call({ to: ALICE })])).toEqual([])
    })

    test('returns the recipient of an ERC20 transfer, not the token', () => {
      const data = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [ALICE, 10n] })

      expect(addressesOf([call({ to: USDC, data })])).toEqual([ALICE])
    })

    test('returns the `to` argument of transferFrom, not the `from`', () => {
      const data = encodeFunctionData({
        abi: erc20,
        functionName: 'transferFrom',
        args: [ACCOUNT, BOB, 10n]
      })

      expect(addressesOf([call({ to: USDC, data })])).toEqual([BOB])
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

      expect(addressesOf([call({ to: NFT, data: withoutData })])).toEqual([ALICE])
      expect(addressesOf([call({ to: NFT, data: withData })])).toEqual([BOB])
    })

    test('ignores contract interactions that are not sends', () => {
      const approve = encodeFunctionData({
        abi: erc20,
        functionName: 'approve',
        args: [ALICE, 10n]
      })

      expect(addressesOf([call({ to: USDC, data: approve })])).toEqual([])
      expect(addressesOf([call({ to: USDC, data: '0x12345678deadbeef' })])).toEqual([])
    })

    test('ignores a payable contract call, because the target is not a recipient', () => {
      const approve = encodeFunctionData({
        abi: erc20,
        functionName: 'approve',
        args: [ALICE, 10n]
      })

      expect(addressesOf([call({ to: USDC, data: approve, value: 1n })])).toEqual([])
    })

    test('does not throw on calldata that only looks like a transfer', () => {
      expect(addressesOf([call({ to: USDC, data: '0xa9059cbb00' })])).not.toBeUndefined()
    })

    test('dedupes recipients across a batch and checksums them', () => {
      const data = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [ALICE, 10n] })

      expect(
        addressesOf([
          call({ to: USDC, data }),
          call({ to: ALICE.toLowerCase(), value: 1n }),
          call({ to: BOB, value: 1n })
        ])
      ).toEqual([ALICE, BOB])
    })

    test('skips a contract deployment, which has no recipient', () => {
      expect(addressesOf([call({ data: '0x60806040', value: 0n })])).toEqual([])
    })
  })
})
