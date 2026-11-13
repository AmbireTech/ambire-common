import { concat, getBytes, isHexString, keccak256 } from 'ethers'

import AmbireDepositorFlags from '../../../contracts/compiled/AmbireDepositorFlags.json'
import { eip7702AmbireContracts } from '../../consts/7702'
import {
  PROXY_AMBIRE_4337_ACCOUNT,
  PROXY_AMBIRE_ACCOUNT,
  PROXY_AMBIRE_V1_ACCOUNT
} from '../../consts/deploy'
import { PRIVACY_POOLS_FINGERPRINT_CHECK_BATCH_SIZE } from '../../consts/privacyPools'
import { RPCProvider } from '../../interfaces/provider'
import { paginate } from '../../utils/paginate'
import { fromDescriptor } from '../deployless/deployless'
import { getProxyRuntimeCode } from '../proxyDeploy/deploy'
import { PrivacyPoolsCoverDeposit } from './poolStats'
import { retryPrivacyPoolsRequest } from './retry'

const EIP_7702_DELEGATION_PREFIX = '0xef0100'
const ADDRESS_BYTES = 20
/** What `AmbireDepositorFlags` returns for an address whose code is an Ambire account's. */
const AMBIRE_ACCOUNT_FLAG = 1

/**
 * The code hashes anyone can see on an Ambire account: an EOA delegated to one of Ambire's 7702
 * contracts, or a smart account proxy of Ambire's, v1 or v2. The hash of a delegated EOA is that of
 * its delegation, not of the contract it delegates to.
 */
export const getAmbireAccountCodeHashes = (): string[] => [
  ...eip7702AmbireContracts.map((delegator) =>
    keccak256(concat([EIP_7702_DELEGATION_PREFIX, delegator]))
  ),
  ...[PROXY_AMBIRE_ACCOUNT, PROXY_AMBIRE_4337_ACCOUNT, PROXY_AMBIRE_V1_ACCOUNT].map(
    (masterContract) => keccak256(getProxyRuntimeCode(masterContract))
  )
]

/**
 * Which of `addresses` have a Kohaku client fingerprint. An address has one when its code at the
 * latest block is an Ambire account's (see `getAmbireAccountCodeHashes`). Keyed by the address in
 * lowercase. Asks in batches of `PRIVACY_POOLS_FINGERPRINT_CHECK_BATCH_SIZE`, retries each a few
 * times, and throws when a batch fails every time.
 */
export const checkKohakuFingerprints = async ({
  provider,
  supportsStateOverride,
  addresses
}: {
  provider: RPCProvider
  supportsStateOverride: boolean
  addresses: string[]
}): Promise<Map<string, boolean>> => {
  const invalidAddress = addresses.find((address) => !isHexString(address, ADDRESS_BYTES))
  if (invalidAddress !== undefined)
    throw new Error(`privacyPools: not an address (${invalidAddress})`)

  const deployless = fromDescriptor(provider, AmbireDepositorFlags, supportsStateOverride)
  const codeHashes = getAmbireAccountCodeHashes()

  const checkBatch = async (batch: string[]): Promise<[string, boolean][]> => {
    const flags: string = await retryPrivacyPoolsRequest(() =>
      deployless.call('getFlags', [concat(batch), codeHashes])
    )
    const flagBytes = getBytes(flags)
    if (flagBytes.length !== batch.length)
      throw new Error(
        `privacyPools: ${flagBytes.length} depositor flags came back for ${batch.length} addresses`
      )

    return batch.map((address, i) => [address.toLowerCase(), flagBytes[i] === AMBIRE_ACCOUNT_FLAG])
  }

  const batches = await Promise.all(
    paginate(addresses, PRIVACY_POOLS_FINGERPRINT_CHECK_BATCH_SIZE).map(checkBatch)
  )

  return new Map(batches.flat())
}

/** The depositors of `deposits` not in `fingerprints` yet, each once. */
export const getUncheckedDepositors = (
  deposits: PrivacyPoolsCoverDeposit[],
  /** Null before any depositor of the chain is checked. */
  fingerprints: ReadonlyMap<string, boolean> | null
): string[] => [
  ...new Set(
    deposits.map(({ depositor }) => depositor).filter((depositor) => !fingerprints?.has(depositor))
  )
]
