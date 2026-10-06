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
const ADAPTER = getAddress('0x0a230D83f16209E2692494a0ae139aAD8C96bde9')
/** The USDC pool, which has an adapter of its own. */
const USDC_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
const USDC_ADAPTER = getAddress('0x16B7d484c634985FbafaaaC6f3ee14e9eFDa4889')
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
const POOL_INTERFACE = new Interface([
  'function withdraw((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
])
const ERC20_INTERFACE = new Interface(['function transfer(address to, uint256 amount)'])

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
  withdrawnValue = AMOUNT
}: {
  adapter?: string
  processooor?: string
  recipient?: string
  feeRecipient?: string
  fee?: bigint
  withdrawnValue?: bigint
} = {}) => {
  const data = coder.encode(
    ['tuple(address recipient, address feeRecipient, uint256 fee)'],
    [{ recipient, feeRecipient, fee }]
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

const SPONSORED_VALUE = (AMOUNT * 3n) / 5n

/** A deposit the sender withdraws itself, in a batch. */
const poolWithdrawCall = ({
  target = POOL,
  processooor = SENDER,
  withdrawnValue = AMOUNT - SPONSORED_VALUE
}: { target?: string; processooor?: string; withdrawnValue?: bigint } = {}) => ({
  target,
  value: 0n,
  data: POOL_INTERFACE.encodeFunctionData('withdraw', [
    { processooor, data: '0x' },
    toProof(withdrawnValue)
  ])
})

const nativeForwardCall = (to = RECIPIENT, value = AMOUNT - FEE) => ({
  target: to,
  value,
  data: '0x'
})

/**
 * A batch of two deposits as the SDK builds it: the larger one sponsored and paid to the sender,
 * the other withdrawn by the sender, then everything minus the fee forwarded.
 */
const buildBatchWithdrawal = (
  calls: { target: string; value: bigint; data: string }[] = [
    poolWithdrawCall(),
    nativeForwardCall()
  ],
  paymasterData = encodePaymasterData({ recipient: SENDER, withdrawnValue: SPONSORED_VALUE })
) =>
  buildWithdrawal({
    userOperation: {
      sender: SENDER,
      callData: SENDER_INTERFACE.encodeFunctionData('executeBatch', [calls]),
      paymaster: PAYMASTER,
      paymasterData
    }
  })

/** What `read` returns for a withdrawal that matches the request. */
const EXPECTED_WITHDRAWAL = {
  recipient: RECIPIENT,
  tokenAddress: NATIVE,
  amount: AMOUNT,
  fee: FEE,
  noteCount: 1
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

  describe('a batch of deposits', () => {
    it('returns what a batch that matches the request does', () => {
      expect(read(buildBatchWithdrawal())).toEqual({ ...EXPECTED_WITHDRAWAL, noteCount: 2 })
    })

    it('returns the recipient of the forward, not the sender the sponsored deposit pays', () => {
      expect(read(buildBatchWithdrawal(), RECIPIENT.toLowerCase()).recipient).toBe(RECIPIENT)
    })

    it('accepts a token batch forwarded with a transfer', () => {
      const withdrawal = buildBatchWithdrawal([
        poolWithdrawCall(),
        {
          target: USDC,
          value: 0n,
          data: ERC20_INTERFACE.encodeFunctionData('transfer', [RECIPIENT, AMOUNT - FEE])
        }
      ])

      expect(read(withdrawal, RECIPIENT.toLowerCase(), USDC)).toEqual({
        ...EXPECTED_WITHDRAWAL,
        tokenAddress: USDC,
        noteCount: 2
      })
    })

    it('refuses a sponsored deposit paid to anyone but the sender', () => {
      expect(() =>
        read(buildBatchWithdrawal(undefined, encodePaymasterData({ recipient: ATTACKER })))
      ).toThrow(/different address/)
    })

    it('refuses a batch that forwards the funds to another address', () => {
      expect(() =>
        read(buildBatchWithdrawal([poolWithdrawCall(), nativeForwardCall(ATTACKER)]))
      ).toThrow(/forwards the funds differently/)
    })

    it('refuses a batch that forwards less than the amount minus the fee', () => {
      expect(() =>
        read(
          buildBatchWithdrawal([
            poolWithdrawCall(),
            nativeForwardCall(RECIPIENT, AMOUNT - 2n * FEE)
          ])
        )
      ).toThrow(/forwards the funds differently/)
    })

    it('refuses a token batch forwarded as native, or to the token by another call', () => {
      expect(() => read(buildBatchWithdrawal(), RECIPIENT, USDC)).toThrow(
        /forwards the funds differently/
      )
      const approveInsteadOfTransfer = new Interface([
        'function approve(address spender, uint256 amount)'
      ]).encodeFunctionData('approve', [RECIPIENT, AMOUNT - FEE])
      expect(() =>
        read(
          buildBatchWithdrawal([
            poolWithdrawCall(),
            { target: USDC, value: 0n, data: approveInsteadOfTransfer }
          ]),
          RECIPIENT,
          USDC
        )
      ).toThrow(/forwards the funds differently/)
    })

    it('refuses a deposit withdrawn to someone other than the sender', () => {
      expect(() =>
        read(
          buildBatchWithdrawal([poolWithdrawCall({ processooor: ATTACKER }), nativeForwardCall()])
        )
      ).toThrow(/pays out to an unexpected address/)
    })

    it('refuses a deposit withdrawn from another contract', () => {
      expect(() =>
        read(buildBatchWithdrawal([poolWithdrawCall({ target: ATTACKER }), nativeForwardCall()]))
      ).toThrow(/unexpected contract/)
    })

    it('refuses deposits that do not add up to the amount', () => {
      expect(() =>
        read(
          buildBatchWithdrawal([
            poolWithdrawCall({ withdrawnValue: AMOUNT - SPONSORED_VALUE + 1n }),
            nativeForwardCall()
          ])
        )
      ).toThrow(/different amount/)
    })

    it('refuses a batch that runs anything but deposits and the forward', () => {
      expect(() =>
        read(
          buildBatchWithdrawal([
            poolWithdrawCall(),
            nativeForwardCall(ATTACKER, 1n),
            nativeForwardCall()
          ])
        )
      ).toThrow(/unexpected contract/)
      expect(() => read(buildBatchWithdrawal([nativeForwardCall()]))).toThrow(/unexpected shape/)
    })

    it('refuses a payout to the sender that runs no batch', () => {
      expect(() =>
        read(
          buildWithdrawal(
            {},
            encodePaymasterData({ recipient: SENDER, withdrawnValue: SPONSORED_VALUE })
          )
        )
      ).toThrow(/unexpected shape/)
    })
  })
})
