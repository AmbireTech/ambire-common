import { AbiCoder, getAddress } from 'ethers'

import { expect } from '@jest/globals'

import { PrivacyPoolsRelayedWithdrawalPayload, readRelayedWithdrawal } from './relayedWithdrawal'

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
  processooor = ENTRYPOINT,
  scope = POOL_SCOPE,
  withdrawnValue = AMOUNT,
  relayerId = 'Fast Relay'
}: {
  relayData?: string
  committedData?: string
  quotedFeeBPS?: bigint
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
      expiresAt: EXPIRATION
    })
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
})
