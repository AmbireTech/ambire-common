import { AbiCoder } from 'ethers'

import { Fetch } from '../../interfaces/fetch'
import { PrivacyPoolsRelayerClient } from './relayerGuard'

/**
 * Talks to a Privacy Pools relayer over HTTP.
 *
 * Written here rather than reused from the SDK because `RelayerClient` is not exported from
 * `@kohaku-eth/privacy-pools` and its `exports` map blocks deep imports - and because the wrapper
 * in `relayerGuard` has to sit around a client we can construct. It also lets the request go
 * through the app's own `fetch`, keeping platform wiring in one place.
 *
 * The three routes match 0xBow's relayer service, which mounts its router at `/relayer`. That
 * prefix belongs to the configured base URL, not to these paths - see
 * `PRIVACY_POOLS_RELAYER_PATH_PREFIX`.
 */

/** The SDK passes addresses around as bigints; the relayer API expects 0x-padded hex. */
const addressToHex = (address: bigint): string => `0x${address.toString(16).padStart(40, '0')}`

const toHex = (value: bigint): string => `0x${value.toString(16)}`

/** `JSON.stringify` cannot serialize a bigint, and proofs are full of them. */
const bigintSafe = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value

export const createRelayerClient = (fetch: Fetch): PrivacyPoolsRelayerClient => {
  const postJson = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, bigintSafe)
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')

      throw new Error(`relayer responded ${response.status}${detail ? `: ${detail}` : ''}`)
    }

    return response.json()
  }

  return {
    async getQuote({ relayerUrl, chainId, amount, asset, recipient, extraGas }) {
      return postJson(`${relayerUrl}/quote`, {
        chainId: toHex(chainId),
        amount: toHex(amount),
        asset: addressToHex(asset),
        recipient: addressToHex(recipient),
        extraGas
      })
    },

    async relay({ relayerUrl, chainId, scope, ...rest }: any) {
      const result = await postJson(`${relayerUrl}/request`, {
        ...rest,
        chainId: toHex(chainId),
        scope: toHex(scope)
      })

      // The relayer reports its own failures with HTTP 200 and `success: false`, so a non-ok body
      // has to be turned into a rejection here or a failed withdrawal looks like a successful one.
      if (!result?.success) throw new Error(result?.error || 'the relayer refused the withdrawal')

      return result
    },

    async getFees({ relayerUrl, chainId, assetAddress }) {
      const url = new URL(`${relayerUrl}/details`)
      url.searchParams.append('assetAddress', addressToHex(assetAddress))
      url.searchParams.append('chainId', chainId.toString(10))

      const response = await fetch(url.toString())

      if (!response.ok) throw new Error(`relayer responded ${response.status}`)

      return response.json()
    }
  }
}

/**
 * A relayer client that never touches the network, so the wallet can broadcast a withdrawal itself.
 *
 * `Entrypoint.relay` has no access control on `msg.sender` - it only requires that
 * `withdrawal.processooor` is the entrypoint - so anyone may submit a relay call, the user
 * included. What the SDK will not do is produce one without a quote: `getWithdrawalPayloads`
 * always quotes first and throws on an empty relayer list. This stands in for that quote with a
 * zero-fee commitment naming the recipient directly, after which `prepareUnshield` returns
 * ordinary `txData` we can sign like any other transaction.
 *
 * `feeRecipient` is set to the recipient rather than left empty because `Entrypoint._transfer`
 * reverts on the zero address even when the amount it is moving is zero.
 *
 * This is a liveness path, not a privacy one: whoever pays the gas appears on chain beside the
 * recipient. See `PrivacyPoolsWithdrawalMode`.
 */
export const createSelfRelayClient = (): PrivacyPoolsRelayerClient => ({
  async getQuote({ recipient }) {
    const recipientHex = addressToHex(recipient)
    const withdrawalData = AbiCoder.defaultAbiCoder().encode(
      ['tuple(address recipient, address feeRecipient, uint256 relayFeeBPS)'],
      [{ recipient: recipientHex, feeRecipient: recipientHex, relayFeeBPS: 0n }]
    )

    return {
      baseFeeBPS: '0',
      feeBPS: '0',
      gasPrice: '0',
      feeCommitment: {
        // Nothing on chain reads the commitment - the entrypoint is handed the withdrawal and the
        // proof, never this - so the window only has to outlast proving.
        expiration: Date.now() + 3_600_000,
        withdrawalData,
        // Unused: no relayer will ever be asked to honour this, since we broadcast it ourselves.
        signedRelayerCommitment: '0x'
      },
      detail: {}
    }
  },

  async relay() {
    throw new Error(
      'privacyPools: a self-relayed withdrawal is broadcast by the wallet, not handed to a relayer'
    )
  },

  async getFees() {
    throw new Error('privacyPools: a self-relayed withdrawal has no relayer fees to quote')
  }
})
