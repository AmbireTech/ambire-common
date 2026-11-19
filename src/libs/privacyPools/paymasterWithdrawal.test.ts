import { AbiCoder, getAddress, Interface } from 'ethers'

import { expect } from '@jest/globals'

import { PrivacyPoolsPaymasterConfig } from '../../interfaces/privacyPools'
import {
  PrivacyPoolsPaymasterWithdrawalPayload,
  readPaymasterWithdrawal
} from './paymasterWithdrawal'

const RECIPIENT = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const ATTACKER = getAddress('0x0000000000000000000000000000000000000bad')
const POOL = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const ADAPTER = getAddress('0x521F578Ac6E894939364Dc27c7e6978Ecf7b7926')
/** The USDC pool, which has an adapter of its own. */
const USDC_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
const USDC_ADAPTER = getAddress('0x841E8F12FDbB2c55c9E054B4c6d07c2743E09cFC')
const PAYMASTER = getAddress('0xe06CB96C57D2442f8F60F5017354BC08F7e91308')
const ENTRY_POINT = getAddress('0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108')
const SENDER = getAddress('0xA3a4D83896ec4b595668fA3d5430157cd235F720')
const NATIVE = '0x0000000000000000000000000000000000000000'
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const AMOUNT = 10n ** 18n
const FEE = 10n ** 15n

const PAYMASTER_CONFIG: PrivacyPoolsPaymasterConfig = {
  entryPointAddress: ENTRY_POINT,
  paymasterAddress: PAYMASTER,
  poolAdapters: { [POOL]: ADAPTER, [USDC_POOL]: USDC_ADAPTER }
}

const coder = AbiCoder.defaultAbiCoder()

const SENDER_INTERFACE = new Interface([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)'
])

const toProof = (withdrawnValue: bigint) => ({
  pA: [1n, 2n],
  pB: [
    [3n, 4n],
    [5n, 6n]
  ],
  pC: [7n, 8n],
  pubSignals: [11n, 12n, withdrawnValue, 14n, 15n, 16n, 17n, 18n]
})

const encodePaymasterData = ({
  adapter = ADAPTER,
  processooor = ADAPTER,
  recipient = RECIPIENT,
  feeRecipient = PAYMASTER,
  fee = FEE,
  refundRecipient = RECIPIENT,
  withdrawnValue = AMOUNT
}: {
  adapter?: string
  processooor?: string
  recipient?: string
  feeRecipient?: string
  fee?: bigint
  refundRecipient?: string
  withdrawnValue?: bigint
} = {}) => {
  const data = coder.encode(
    ['tuple(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'],
    [{ recipient, feeRecipient, fee, refundRecipient }]
  )
  const adapterData = coder.encode(
    [
      'tuple(tuple(address processooor, bytes data) withdrawal, tuple(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
    ],
    [
      {
        withdrawal: { processooor, data },
        proof: toProof(withdrawnValue)
      }
    ]
  )

  return coder.encode(['tuple(address adapter, bytes adapterData)'], [{ adapter, adapterData }])
}

const buildWithdrawal = (
  overrides: Partial<PrivacyPoolsPaymasterWithdrawalPayload> = {},
  paymasterData = encodePaymasterData()
): PrivacyPoolsPaymasterWithdrawalPayload => ({
  poolAddress: BigInt(POOL),
  paymasterAddress: PAYMASTER,
  entryPointAddress: ENTRY_POINT,
  userOperation: { sender: SENDER, callData: '0x', paymaster: PAYMASTER, paymasterData },
  ...overrides
})

const read = (
  withdrawal: PrivacyPoolsPaymasterWithdrawalPayload,
  recipient = RECIPIENT,
  tokenAddress = NATIVE,
  poolAddress = POOL
) =>
  readPaymasterWithdrawal({
    withdrawal,
    paymaster: PAYMASTER_CONFIG,
    poolAddress,
    recipient,
    tokenAddress,
    amount: AMOUNT
  })

const nativeForwardCall = (to = RECIPIENT, value = AMOUNT - FEE) => ({
  target: to,
  value,
  data: '0x'
})

/** What `read` returns for a withdrawal that matches the request. */
const EXPECTED_WITHDRAWAL = {
  recipient: RECIPIENT,
  tokenAddress: NATIVE,
  amount: AMOUNT,
  fee: FEE
}

describe('libs/privacyPools/paymasterWithdrawal', () => {
  it('returns what a withdrawal that matches the request does', () => {
    expect(read(buildWithdrawal())).toEqual(EXPECTED_WITHDRAWAL)
  })

  it('returns the recipient as the payload pays it, checksummed', () => {
    expect(read(buildWithdrawal(), RECIPIENT.toLowerCase())).toEqual(EXPECTED_WITHDRAWAL)
  })

  it('refuses a withdrawal from the pool of another token', () => {
    // The ETH pool's withdrawal, asked for as USDC: the amount would read as USDC
    expect(() => read(buildWithdrawal(), RECIPIENT, USDC, USDC_POOL)).toThrow(
      /pool of a different token/
    )
    // Another token's pool, routed through that pool's own adapter
    expect(() =>
      read(
        buildWithdrawal(
          { poolAddress: BigInt(USDC_POOL) },
          encodePaymasterData({ adapter: USDC_ADAPTER, processooor: USDC_ADAPTER })
        )
      )
    ).toThrow(/pool of a different token/)
  })

  it('refuses a withdrawal that pays out to another address', () => {
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ recipient: ATTACKER })))).toThrow(
      /different address/
    )
  })

  it('refuses a withdrawal whose fee goes to someone other than the paymaster', () => {
    expect(() =>
      read(buildWithdrawal({}, encodePaymasterData({ feeRecipient: ATTACKER })))
    ).toThrow(/fee goes to an unexpected address/)
  })

  it('refuses a withdrawal that refunds unused gas to anyone but the recipient', () => {
    expect(() =>
      read(buildWithdrawal({}, encodePaymasterData({ refundRecipient: ATTACKER })))
    ).toThrow(/refunds unused gas to an unexpected address/)
    // The zero address keeps the refund with the paymaster
    expect(() =>
      read(buildWithdrawal({}, encodePaymasterData({ refundRecipient: NATIVE })))
    ).toThrow(/refunds unused gas to an unexpected address/)
  })

  it('refuses a withdrawal routed through another adapter', () => {
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ processooor: ATTACKER })))).toThrow(
      /unexpected adapter/
    )
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ adapter: ATTACKER })))).toThrow(
      /unexpected adapter/
    )
  })

  it('refuses a withdrawal sponsored by another paymaster', () => {
    expect(() =>
      read(
        buildWithdrawal({
          userOperation: { paymaster: ATTACKER, paymasterData: encodePaymasterData() }
        })
      )
    ).toThrow(/unexpected paymaster/)
  })

  it('refuses a withdrawal sent to another entry point', () => {
    expect(() => read(buildWithdrawal({ entryPointAddress: ATTACKER }))).toThrow(
      /unexpected ERC-4337 entry point/
    )
  })

  it('refuses a pool with no configured adapter', () => {
    expect(() => read(buildWithdrawal({ poolAddress: BigInt(ATTACKER) }))).toThrow(
      /no paymaster adapter/
    )
  })

  it('refuses a proof over a different amount', () => {
    expect(() =>
      read(buildWithdrawal({}, encodePaymasterData({ withdrawnValue: AMOUNT + 1n })))
    ).toThrow(/different amount/)
  })

  it('refuses a fee that takes the whole amount', () => {
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ fee: AMOUNT })))).toThrow(
      /whole amount/
    )
  })

  it('refuses a single deposit that also runs calls', () => {
    expect(() =>
      read(
        buildWithdrawal({
          userOperation: {
            sender: SENDER,
            callData: SENDER_INTERFACE.encodeFunctionData('executeBatch', [[nativeForwardCall()]]),
            paymaster: PAYMASTER,
            paymasterData: encodePaymasterData()
          }
        })
      )
    ).toThrow(/runs calls it should not/)
  })

  it('refuses a payout to the single-use sender, as a batch of deposits would make', () => {
    const paidToSender = encodePaymasterData({ recipient: SENDER })
    expect(() => read(buildWithdrawal({}, paidToSender))).toThrow(/different address/)
    expect(() =>
      read(
        buildWithdrawal({
          userOperation: {
            sender: SENDER,
            callData: SENDER_INTERFACE.encodeFunctionData('executeBatch', [[nativeForwardCall()]]),
            paymaster: PAYMASTER,
            paymasterData: paidToSender
          }
        })
      )
    ).toThrow(/different address/)
  })
})
