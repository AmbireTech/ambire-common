import { AbiCoder, getAddress } from 'ethers'

import { expect } from '@jest/globals'

import {
  PrivacyPoolsRelayedWithdrawalError,
  PrivacyPoolsRelayedWithdrawalPayload,
  PrivacyPoolsRelayedWithdrawalRefusal,
  readRelayedWithdrawal
} from './relayedWithdrawal'

const RECIPIENT = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const ATTACKER = getAddress('0x0000000000000000000000000000000000000bad')
const RELAYER_FEE_RECIPIENT = getAddress('0xEC15c20015e72748F03065ed80c41cb882E3fB66')
const ENTRYPOINT = getAddress('0x6818809EefCe719E480a7526D76bD3e561526b46')
const NATIVE = '0x0000000000000000000000000000000000000000'
const RELAYERS = { 'Fast Relay': 'https://fastrelay.xyz/relayer' }

const AMOUNT = 10n ** 17n
const POOL_SCOPE = 1234n
/** 0.18%, as Fast Relay quotes a send of 0.1 ETH. */
const FEE_BPS = 18n
/** The relayers' own 0.1%, the rest of `FEE_BPS` being what they charge for gas. */
const BASE_FEE_BPS = 10n
const MAX_RELAY_FEE_BPS = 1_000n
const EXPIRATION = 1_700_000_060_000

const encodeRelayData = ({
  recipient = RECIPIENT,
  feeRecipient = RELAYER_FEE_RECIPIENT,
  relayFeeBPS = FEE_BPS
}: { recipient?: string; feeRecipient?: string; relayFeeBPS?: bigint } = {}) =>
  AbiCoder.defaultAbiCoder().encode(
    ['tuple(address recipient, address feeRecipient, uint256 relayFeeBPS)'],
    [{ recipient, feeRecipient, relayFeeBPS }]
  )

/** A relayed withdrawal the way the SDK hands it over. The proof itself is never verified here. */
const buildWithdrawal = ({
  relayData = encodeRelayData(),
  committedData = relayData,
  quotedFeeBPS = FEE_BPS,
  baseFeeBPS = BASE_FEE_BPS.toString(),
  processooor = ENTRYPOINT,
  scope = POOL_SCOPE,
  withdrawnValue = AMOUNT,
  relayerId = 'Fast Relay'
}: {
  relayData?: string
  committedData?: string
  quotedFeeBPS?: bigint
  baseFeeBPS?: string
  processooor?: string
  scope?: bigint
  withdrawnValue?: bigint
  relayerId?: string
} = {}): PrivacyPoolsRelayedWithdrawalPayload => ({
  rawData: {
    proof: {
      proof: {
        pi_a: ['1', '2', '1'],
        pi_b: [
          ['3', '4'],
          ['5', '6'],
          ['1', '0']
        ],
        pi_c: ['7', '8', '1']
      },
      publicSignals: ['11', '12', withdrawnValue.toString(), '14', '15', '16', '17', '18']
    },
    withdrawalPayload: { processooor, data: relayData },
    scope
  },
  quoteData: {
    quote: {
      feeBPS: quotedFeeBPS.toString(),
      baseFeeBPS,
      feeCommitment: { expiration: EXPIRATION, withdrawalData: committedData }
    },
    relayerId
  }
})

const read = (withdrawal: PrivacyPoolsRelayedWithdrawalPayload, recipient = RECIPIENT) =>
  readRelayedWithdrawal({
    withdrawal,
    relayers: RELAYERS,
    entrypointAddress: ENTRYPOINT,
    poolScope: POOL_SCOPE,
    maxRelayFeeBPS: MAX_RELAY_FEE_BPS,
    recipient,
    tokenAddress: NATIVE,
    amount: AMOUNT
  })

describe('libs/privacyPools/relayedWithdrawal', () => {
  it('returns what a withdrawal that matches the request does, with the fee the entrypoint takes', () => {
    expect(read(buildWithdrawal())).toEqual({
      recipient: RECIPIENT,
      tokenAddress: NATIVE,
      amount: AMOUNT,
      fee: (AMOUNT * FEE_BPS) / 10_000n,
      serviceFee: (AMOUNT * BASE_FEE_BPS) / 10_000n,
      expiresAt: EXPIRATION
    })
  })

  it('keeps the service fee within the fee, rounded down as the entrypoint rounds it', () => {
    // 1,234,567 wei: 18 bps is 2,222.2 wei and 10 bps 1,234.5 wei, both rounded down
    const amount = 1_234_567n
    const { fee, serviceFee } = readRelayedWithdrawal({
      withdrawal: buildWithdrawal({ withdrawnValue: amount }),
      relayers: RELAYERS,
      entrypointAddress: ENTRYPOINT,
      poolScope: POOL_SCOPE,
      maxRelayFeeBPS: MAX_RELAY_FEE_BPS,
      recipient: RECIPIENT,
      tokenAddress: NATIVE,
      amount
    })

    expect(fee).toBe(2_222n)
    expect(serviceFee).toBe(1_234n)
  })

  it('shows no more than the committed fee as the service fee, so the network fee is never negative', () => {
    const withdrawal = buildWithdrawal({
      relayData: encodeRelayData({ relayFeeBPS: 5n }),
      baseFeeBPS: '10'
    })

    const { fee, serviceFee } = read(withdrawal)

    expect(serviceFee).toBe(fee)
  })

  it.each([
    ['is missing', undefined],
    ['is empty', ''],
    ['is negative', '-10'],
    ['is not a whole number', '10.5'],
    ['is in hex', '0x0a'],
    ['has spaces around it', ' 10 ']
  ])('refuses a quote whose service fee %s', (_case, baseFeeBPS) => {
    const withdrawal = buildWithdrawal()
    ;(withdrawal.quoteData.quote as { baseFeeBPS?: string }).baseFeeBPS = baseFeeBPS

    expect(() => read(withdrawal)).toThrow(/no valid service fee/)
  })

  it('returns the recipient as the payload pays it, checksummed', () => {
    expect(read(buildWithdrawal(), RECIPIENT.toLowerCase()).recipient).toBe(RECIPIENT)
  })

  it('accepts a relayer that committed to less than it quoted', () => {
    const withdrawal = buildWithdrawal({ relayData: encodeRelayData({ relayFeeBPS: 10n }) })

    expect(read(withdrawal).fee).toBe((AMOUNT * 10n) / 10_000n)
  })

  it('refuses a withdrawal that pays out to another address', () => {
    expect(() =>
      read(buildWithdrawal({ relayData: encodeRelayData({ recipient: ATTACKER }) }))
    ).toThrow(/different address/)
  })

  it('refuses a fee above the quoted one, or above what the pool allows', () => {
    expect(() =>
      read(buildWithdrawal({ relayData: encodeRelayData({ relayFeeBPS: FEE_BPS + 1n }) }))
    ).toThrow(/higher fee than it quoted/)
    expect(() =>
      read(
        buildWithdrawal({
          relayData: encodeRelayData({ relayFeeBPS: MAX_RELAY_FEE_BPS + 1n }),
          quotedFeeBPS: MAX_RELAY_FEE_BPS + 1n
        })
      )
    ).toThrow(/above what the pool allows/)
  })

  it('refuses a fee that takes the whole amount', () => {
    expect(() =>
      readRelayedWithdrawal({
        withdrawal: buildWithdrawal({
          relayData: encodeRelayData({ relayFeeBPS: 10_000n }),
          quotedFeeBPS: 10_000n
        }),
        relayers: RELAYERS,
        entrypointAddress: ENTRYPOINT,
        poolScope: POOL_SCOPE,
        maxRelayFeeBPS: 10_000n,
        recipient: RECIPIENT,
        tokenAddress: NATIVE,
        amount: AMOUNT
      })
    ).toThrow(/whole amount/)
  })

  it('refuses a withdrawal that differs from what the relayer signed', () => {
    expect(() =>
      read(buildWithdrawal({ committedData: encodeRelayData({ recipient: ATTACKER }) }))
    ).toThrow(/differs from what the relayer committed to/)
  })

  it('refuses a withdrawal from the pool of another token', () => {
    expect(() => read(buildWithdrawal({ scope: POOL_SCOPE + 1n }))).toThrow(
      /pool of a different token/
    )
  })

  it('refuses a withdrawal processed by anything but the entrypoint', () => {
    expect(() => read(buildWithdrawal({ processooor: ATTACKER }))).toThrow(
      /processed by an unexpected contract/
    )
  })

  it('refuses a relayer that is not configured, even one named like an object key', () => {
    expect(() => read(buildWithdrawal({ relayerId: 'Evil Relay' }))).toThrow(/unknown relayer/)
    expect(() => read(buildWithdrawal({ relayerId: 'constructor' }))).toThrow(/unknown relayer/)
  })

  it('refuses a proof over a different amount', () => {
    expect(() => read(buildWithdrawal({ withdrawnValue: AMOUNT + 1n }))).toThrow(/different amount/)
  })

  /** The error `readWithdrawal` threw, or undefined when it did not throw. */
  const readRefusal = (readWithdrawal: () => unknown) => {
    try {
      readWithdrawal()
    } catch (error) {
      return error
    }

    return undefined
  }

  it.each<[PrivacyPoolsRelayedWithdrawalRefusal, () => unknown]>([
    ['unknown-relayer', () => read(buildWithdrawal({ relayerId: 'Evil Relay' }))],
    ['different-pool', () => read(buildWithdrawal({ scope: POOL_SCOPE + 1n }))],
    ['unexpected-contract', () => read(buildWithdrawal({ processooor: ATTACKER }))],
    [
      'differs-from-commitment',
      () => read(buildWithdrawal({ committedData: encodeRelayData({ recipient: ATTACKER }) }))
    ],
    [
      'different-recipient',
      () => read(buildWithdrawal({ relayData: encodeRelayData({ recipient: ATTACKER }) }))
    ],
    [
      'fee-above-quote',
      () => read(buildWithdrawal({ relayData: encodeRelayData({ relayFeeBPS: FEE_BPS + 1n }) }))
    ],
    [
      'fee-above-pool-limit',
      () =>
        read(
          buildWithdrawal({
            relayData: encodeRelayData({ relayFeeBPS: MAX_RELAY_FEE_BPS + 1n }),
            quotedFeeBPS: MAX_RELAY_FEE_BPS + 1n
          })
        )
    ],
    ['different-amount', () => read(buildWithdrawal({ withdrawnValue: AMOUNT + 1n }))],
    [
      'fee-takes-whole-amount',
      () =>
        readRelayedWithdrawal({
          withdrawal: buildWithdrawal({
            relayData: encodeRelayData({ relayFeeBPS: 10_000n }),
            quotedFeeBPS: 10_000n
          }),
          relayers: RELAYERS,
          entrypointAddress: ENTRYPOINT,
          poolScope: POOL_SCOPE,
          maxRelayFeeBPS: 10_000n,
          recipient: RECIPIENT,
          tokenAddress: NATIVE,
          amount: AMOUNT
        })
    ],
    ['invalid-service-fee', () => read(buildWithdrawal({ baseFeeBPS: '-1' }))]
  ])('tells why it refused, so the caller can pick what to tell the user: %s', (reason, readIt) => {
    const refusal = readRefusal(readIt)

    expect(refusal).toBeInstanceOf(PrivacyPoolsRelayedWithdrawalError)
    expect(refusal).toHaveProperty('reason', reason)
  })
})
