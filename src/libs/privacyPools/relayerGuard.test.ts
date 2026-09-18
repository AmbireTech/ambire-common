import { AbiCoder, formatUnits, getAddress } from 'ethers'

import { expect } from '@jest/globals'

import {
  assertQuoteMatchesRequest,
  createGuardedRelayerClient,
  decodeRelayData,
  PrivacyPoolsQuoteResponse,
  PrivacyPoolsRelayerClient,
  PrivacyPoolsRelayerQuoteError
} from './relayerGuard'

const RECIPIENT = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const ATTACKER = getAddress('0x0000000000000000000000000000000000000bad')
const FEE_RECIPIENT = getAddress('0x976EA74026E726554dB657fA54763abd0C3a0aa9')

const NOW = 1_700_000_000_000
const RELAYER = 'Fast Relay'
const RELAYER_URL = 'https://fastrelay.xyz/relayer'

const encodeRelayData = (recipient: string, feeRecipient: string, relayFeeBps: bigint) =>
  AbiCoder.defaultAbiCoder().encode(
    ['tuple(address recipient, address feeRecipient, uint256 relayFeeBPS)'],
    [{ recipient, feeRecipient, relayFeeBPS: relayFeeBps }]
  )

const buildQuote = ({
  recipient = RECIPIENT,
  committedFeeBps = 100n,
  advertisedFeeBps = '100',
  expiration = NOW + 3_600_000
}: {
  recipient?: string
  committedFeeBps?: bigint
  advertisedFeeBps?: string
  expiration?: number
} = {}): PrivacyPoolsQuoteResponse => ({
  baseFeeBPS: '50',
  feeBPS: advertisedFeeBps,
  gasPrice: '1000000000',
  feeCommitment: {
    expiration,
    withdrawalData: encodeRelayData(recipient, FEE_RECIPIENT, committedFeeBps),
    signedRelayerCommitment: '0xsignature'
  },
  detail: {}
})

const assertWith = (quote: PrivacyPoolsQuoteResponse) =>
  assertQuoteMatchesRequest({
    quote,
    relayerName: RELAYER,
    requestedRecipient: BigInt(RECIPIENT),
    now: NOW
  })

describe('libs/privacyPools/relayerGuard', () => {
  describe('decodeRelayData', () => {
    it('recovers the tuple the entrypoint will split funds by', () => {
      expect(decodeRelayData(encodeRelayData(RECIPIENT, FEE_RECIPIENT, 250n))).toEqual({
        recipient: RECIPIENT,
        feeRecipient: FEE_RECIPIENT,
        relayFeeBps: 250n
      })
    })
  })

  describe('assertQuoteMatchesRequest', () => {
    it('accepts a quote that commits to the requested withdrawal', () => {
      expect(assertWith(buildQuote())).toEqual({
        recipient: RECIPIENT,
        feeRecipient: FEE_RECIPIENT,
        relayFeeBps: 100n
      })
    })

    it('accepts a recipient that differs only in checksum casing', () => {
      expect(() =>
        assertQuoteMatchesRequest({
          quote: buildQuote({ recipient: RECIPIENT.toLowerCase() }),
          relayerName: RELAYER,
          requestedRecipient: BigInt(RECIPIENT),
          now: NOW
        })
      ).not.toThrow()
    })

    // The reason this guard exists: the proof binds to the relayer's bytes, so a swapped
    // recipient means proving our own note into someone else's pocket.
    it('rejects a quote that redirects the funds to another address', () => {
      expect(() => assertWith(buildQuote({ recipient: ATTACKER }))).toThrow(
        PrivacyPoolsRelayerQuoteError
      )
      expect(() => assertWith(buildQuote({ recipient: ATTACKER }))).toThrow(
        /different address than the one you entered/
      )
    })

    it('rejects a commitment that charges more than the quote advertised', () => {
      expect(() =>
        assertWith(buildQuote({ advertisedFeeBps: '100', committedFeeBps: 101n }))
      ).toThrow(/quoted one fee and committed to a higher one/)
    })

    it('lets a large but honestly advertised fee through, since the ceiling is off', () => {
      expect(() =>
        assertWith(buildQuote({ advertisedFeeBps: '5000', committedFeeBps: 5000n }))
      ).not.toThrow()
    })

    it('still rejects a fee above the ceiling when one is passed', () => {
      expect(() =>
        assertQuoteMatchesRequest({
          quote: buildQuote({ advertisedFeeBps: '5000', committedFeeBps: 5000n }),
          relayerName: RELAYER,
          requestedRecipient: BigInt(RECIPIENT),
          now: NOW,
          maxRelayFeeBps: 1000n
        })
      ).toThrow(/too large a share/)
    })

    /**
     * The numbers are the real Sepolia ones: a 0.001 ETH withdrawal whose relayer wanted 63.47%,
     * against an entrypoint configured to allow 1%. That combination reverts on chain with
     * `RelayFeeGreaterThanMax()` after the proof has been built.
     */
    const assertAgainstEntrypoint = (
      overrides: Partial<Parameters<typeof assertQuoteMatchesRequest>[0]> = {}
    ) =>
      assertQuoteMatchesRequest({
        quote: buildQuote({ advertisedFeeBps: '6347', committedFeeBps: 6347n }),
        relayerName: RELAYER,
        requestedRecipient: BigInt(RECIPIENT),
        requestedAmount: 10n ** 15n,
        onChainMaxRelayFeeBps: 100n,
        describeAmount: (amount) => `${formatUnits(amount, 18)} ETH`,
        now: NOW,
        ...overrides
      })

    it('rejects a fee above the entrypoint ceiling instead of letting it revert on chain', () => {
      expect(() => assertAgainstEntrypoint()).toThrow(PrivacyPoolsRelayerQuoteError)
    })

    it('names the amount that would clear the entrypoint ceiling', () => {
      // 0.001 * 6347 / 100 = 0.06347 - the point where a fee of that size is 1% of the withdrawal.
      expect(() => assertAgainstEntrypoint()).toThrow(/Withdraw about 0.06347 ETH or more/)
    })

    it('rounds the suggested amount up, so the suggestion is never itself refused', () => {
      expect(() =>
        assertAgainstEntrypoint({
          requestedAmount: 3n,
          onChainMaxRelayFeeBps: 2n,
          quote: buildQuote({ advertisedFeeBps: '3', committedFeeBps: 3n }),
          describeAmount: (amount) => `${amount} wei`
        })
      ).toThrow(/about 5 wei/)
    })

    it('accepts a fee sitting exactly on the entrypoint ceiling', () => {
      expect(() =>
        assertAgainstEntrypoint({
          quote: buildQuote({ advertisedFeeBps: '100', committedFeeBps: 100n })
        })
      ).not.toThrow()
    })

    it('leaves the check off when the ceiling could not be read, rather than guessing', () => {
      expect(() => assertAgainstEntrypoint({ onChainMaxRelayFeeBps: null })).not.toThrow()
    })

    it('still explains itself when the amount cannot be rendered in the asset units', () => {
      expect(() => assertAgainstEntrypoint({ describeAmount: undefined })).toThrow(
        /Try withdrawing a larger amount/
      )
    })

    it('rejects withdrawal data that is not a relay tuple at all', () => {
      const quote = buildQuote()
      quote.feeCommitment.withdrawalData = '0xdeadbeef'

      expect(() => assertWith(quote)).toThrow(/could not read/)
    })

    it('rejects a commitment that expires before a proof could be generated', () => {
      expect(() => assertWith(buildQuote({ expiration: NOW + 5_000 }))).toThrow(/expired/)
    })

    it('rejects an already expired commitment', () => {
      expect(() => assertWith(buildQuote({ expiration: NOW - 1 }))).toThrow(/expired/)
    })

    it('accepts a commitment sitting exactly on the headroom boundary', () => {
      expect(() =>
        assertQuoteMatchesRequest({
          quote: buildQuote({ expiration: NOW + 60_000 }),
          relayerName: RELAYER,
          requestedRecipient: BigInt(RECIPIENT),
          now: NOW,
          minRemainingMs: 60_000
        })
      ).not.toThrow()
    })

    it('accepts a zero fee, which is what a self-relayed withdrawal commits to', () => {
      expect(
        assertWith(buildQuote({ advertisedFeeBps: '0', committedFeeBps: 0n })).relayFeeBps
      ).toBe(0n)
    })
  })

  describe('createGuardedRelayerClient', () => {
    // The wrapper checks against the real clock, so these fixtures cannot use the frozen NOW.
    const liveQuote = (overrides: Parameters<typeof buildQuote>[0] = {}) =>
      buildQuote({ expiration: Date.now() + 3_600_000, ...overrides })

    const buildClient = (
      quote: PrivacyPoolsQuoteResponse,
      getOnChainMaxRelayFeeBps?: (asset: bigint) => Promise<bigint | null>
    ) => {
      const getQuote = jest.fn().mockResolvedValue(quote)
      const relay = jest.fn().mockResolvedValue({ success: true })
      const getFees = jest.fn().mockResolvedValue({ feeBPS: '10' })
      const onRejected = jest.fn()

      const guarded = createGuardedRelayerClient({
        client: { getQuote, relay, getFees } as unknown as PrivacyPoolsRelayerClient,
        relayerNameByUrl: new Map([[RELAYER_URL, RELAYER]]),
        getOnChainMaxRelayFeeBps,
        describeAmount: (_asset, amount) => `${formatUnits(amount, 18)} ETH`,
        onRejected
      })

      return { guarded, getQuote, relay, getFees, onRejected }
    }

    const request = {
      relayerUrl: RELAYER_URL,
      chainId: 1n,
      amount: 10n ** 18n,
      asset: 0n,
      recipient: BigInt(RECIPIENT)
    }

    it('passes a valid quote through untouched', async () => {
      const quote = liveQuote()
      const { guarded, onRejected } = buildClient(quote)

      await expect(guarded.getQuote(request)).resolves.toBe(quote)
      expect(onRejected).not.toHaveBeenCalled()
    })

    it('throws and reports when the relayer redirects the funds', async () => {
      const { guarded, onRejected } = buildClient(liveQuote({ recipient: ATTACKER }))

      await expect(guarded.getQuote(request)).rejects.toThrow(PrivacyPoolsRelayerQuoteError)
      expect(onRejected).toHaveBeenCalledWith(RELAYER, expect.any(Error))
    })

    it('names the relayer by its URL when it is not in the map', async () => {
      const { guarded, onRejected } = buildClient(liveQuote({ recipient: ATTACKER }))

      await guarded.getQuote({ ...request, relayerUrl: 'https://unknown.example' }).catch(() => {})

      expect(onRejected).toHaveBeenCalledWith('https://unknown.example', expect.any(Error))
    })

    it('refuses a quote the entrypoint would revert, before anything is proved', async () => {
      const { guarded, onRejected } = buildClient(
        liveQuote({ advertisedFeeBps: '6347', committedFeeBps: 6347n }),
        async () => 100n
      )

      await expect(guarded.getQuote({ ...request, amount: 10n ** 15n })).rejects.toThrow(
        /Withdraw about 0.06347 ETH or more/
      )
      expect(onRejected).toHaveBeenCalledWith(RELAYER, expect.any(Error))
    })

    it('lets the quote through when the ceiling cannot be read', async () => {
      const quote = liveQuote({ advertisedFeeBps: '6347', committedFeeBps: 6347n })
      const { guarded } = buildClient(quote, async () => null)

      await expect(guarded.getQuote({ ...request, amount: 10n ** 15n })).resolves.toBe(quote)
    })

    it('does not second-guess relay and getFees', async () => {
      const { guarded, relay, getFees } = buildClient(liveQuote())

      await guarded.relay({ any: 'payload' })
      await guarded.getFees({ relayerUrl: RELAYER_URL, chainId: 1n, assetAddress: 0n })

      expect(relay).toHaveBeenCalledWith({ any: 'payload' })
      expect(getFees).toHaveBeenCalled()
    })
  })
})
