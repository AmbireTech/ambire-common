import { HDNodeWallet, Mnemonic } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import {
  PRIVACY_POOLS_KEY_ROOT_PATH,
  PRIVACY_POOLS_SIGNING_KEY_PATH
} from '../../consts/privacyPools'
import {
  decodePrivacyKeyNode,
  encodePrivacyKeyMaterial,
  getPathBelow,
  getPrivacyKeyScope,
  isPrivacyProviderId,
  PRIVACY_KEY_SCOPES
} from './privacyKeys'

const PHRASE = 'fashion blossom click cost club ring vapor know wisdom enlist neither receive'
const masterNode = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(PHRASE), 'm')
const privacyPoolsScope = PRIVACY_KEY_SCOPES.privacyPools

const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('privacy key scopes', () => {
  test.each(Object.entries(PRIVACY_KEY_SCOPES))(
    '%s stores a node that is hardened all the way down, so it cannot reach its parent',
    (_, { rootPath }) => {
      const [master, ...segments] = rootPath.split('/')

      expect(master).toBe('m')
      expect(segments.length).toBeGreaterThan(0)
      segments.forEach((segment) => expect(segment.endsWith("'")).toBe(true))
    }
  )

  test('Privacy Pools allows its signing key alone, which is below its stored node', () => {
    expect(privacyPoolsScope.isAllowedPath(PRIVACY_POOLS_SIGNING_KEY_PATH)).toBe(true)
    expect(getPathBelow(privacyPoolsScope.rootPath, PRIVACY_POOLS_SIGNING_KEY_PATH)).toBe("0'")

    const refusedPaths = [
      "m/44'/60'/0'/0/0",
      PRIVACY_POOLS_KEY_ROOT_PATH,
      "m/28784'/1'/1'",
      `${PRIVACY_POOLS_SIGNING_KEY_PATH}/0'`
    ]
    refusedPaths.forEach((path) => expect(privacyPoolsScope.isAllowedPath(path)).toBe(false))
  })

  test('only an own key of the scopes is a provider', () => {
    expect(isPrivacyProviderId('privacyPools')).toBe(true)
    ;['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'tornadoCash', ''].forEach(
      (providerId) => {
        expect(isPrivacyProviderId(providerId)).toBe(false)
        expect(() => getPrivacyKeyScope(providerId)).toThrow('not a privacy provider')
      }
    )
  })
})

describe('getPathBelow', () => {
  test('gives the path relative to the root', () => {
    expect(getPathBelow("m/28784'/1'", "m/28784'/1'/0'/2'")).toBe("0'/2'")
  })

  test('compares whole segments, and refuses the root itself or a path outside it', () => {
    ;[
      "m/28784'/1'0'",
      "m/28784'/1'",
      "m/28784'/1'/",
      "m/28784'/10'/0'",
      "m/44'/60'/0'/0/0"
    ].forEach((path) => expect(() => getPathBelow("m/28784'/1'", path)).toThrow('is not below'))
  })
})

describe('privacy key material', () => {
  test("stores the provider's node, which derives the keys below it exactly as the phrase does", () => {
    const node = decodePrivacyKeyNode(
      encodePrivacyKeyMaterial(masterNode, privacyPoolsScope),
      privacyPoolsScope
    )

    expect(node.depth).toBe(2)
    expect(
      node.derivePath(getPathBelow(privacyPoolsScope.rootPath, PRIVACY_POOLS_SIGNING_KEY_PATH))
        .privateKey
    ).toBe(masterNode.derivePath(PRIVACY_POOLS_SIGNING_KEY_PATH).privateKey)
    // Never the master node, from which every EVM key of the phrase derives
    expect(node.privateKey).not.toBe(masterNode.privateKey)
    // A node below the root refuses absolute paths, so it can't be pointed back at the master
    expect(() => node.derivePath("m/44'/60'/0'/0/0")).toThrow('cannot derive root path')
  })

  test('never quotes what it cannot read', () => {
    const secret = 'word '.repeat(12).trim()

    let error: any
    try {
      decodePrivacyKeyNode(new TextEncoder().encode(secret), privacyPoolsScope)
    } catch (e) {
      error = e
    }

    expect(error.message).toBe('keystore: the stored privacy key is unreadable')
    expect(error.cause).toBeUndefined()
  })

  test('refuses an entry of another kind, path or depth, or without a private key', () => {
    const xprv = masterNode.derivePath(PRIVACY_POOLS_KEY_ROOT_PATH).extendedKey
    const refusedEntries = [
      null,
      [],
      { kind: 'privateKey', path: PRIVACY_POOLS_KEY_ROOT_PATH, xprv },
      { kind: 'bip32Node', path: PRIVACY_POOLS_SIGNING_KEY_PATH, xprv },
      { kind: 'bip32Node', path: PRIVACY_POOLS_KEY_ROOT_PATH },
      { kind: 'bip32Node', path: PRIVACY_POOLS_KEY_ROOT_PATH, xprv: 42 },
      // The right path, but the node of another one
      {
        kind: 'bip32Node',
        path: PRIVACY_POOLS_KEY_ROOT_PATH,
        xprv: masterNode.derivePath(PRIVACY_POOLS_SIGNING_KEY_PATH).extendedKey
      },
      { kind: 'bip32Node', path: PRIVACY_POOLS_KEY_ROOT_PATH, xprv: masterNode.extendedKey },
      // An extended public key, which derives no private keys
      {
        kind: 'bip32Node',
        path: PRIVACY_POOLS_KEY_ROOT_PATH,
        xprv: masterNode.derivePath(PRIVACY_POOLS_KEY_ROOT_PATH).neuter().extendedKey
      }
    ]

    refusedEntries.forEach((entry) =>
      expect(() => decodePrivacyKeyNode(encodeJson(entry), privacyPoolsScope)).toThrow(
        'the stored privacy key is not the one of this provider'
      )
    )
  })

  test('never quotes an extended key it cannot read', () => {
    const xprv = masterNode.derivePath(PRIVACY_POOLS_KEY_ROOT_PATH).extendedKey
    // Too short to be one, as ethers checks the length of an extended key but not its checksum
    const brokenXprv = xprv.slice(0, -5)

    let error: any
    try {
      decodePrivacyKeyNode(
        encodeJson({ kind: 'bip32Node', path: PRIVACY_POOLS_KEY_ROOT_PATH, xprv: brokenXprv }),
        privacyPoolsScope
      )
    } catch (e) {
      error = e
    }

    expect(error).toBeDefined()
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(
      brokenXprv.slice(4, 20)
    )
  })
})
