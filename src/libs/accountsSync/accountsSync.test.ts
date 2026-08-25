import { getBytes, getCreate2Address, keccak256, toUtf8Bytes } from 'ethers'
import { gzip } from 'pako'

import { AMBIRE_ACCOUNT_FACTORY } from '@/consts/deploy'
import { CIPHER, CIPHER_OLD } from '@/libs/keystore/keystore'

import {
  ACCOUNTS_SYNC_PAYLOAD_VERSION,
  AccountsSyncPayload,
  parseAccountsSyncPayload,
  serializeAccountsSyncPayload
} from './accountsSync'

const ACCOUNT_CREATION = {
  factoryAddr: AMBIRE_ACCOUNT_FACTORY,
  bytecode: `0x${'60'.repeat(120)}`,
  salt: `0x${'00'.repeat(32)}`
}
// The parser verifies the address against the creation data, so it can't be an arbitrary one
const ACCOUNT_ADDR = getCreate2Address(
  ACCOUNT_CREATION.factoryAddr,
  ACCOUNT_CREATION.salt,
  keccak256(ACCOUNT_CREATION.bytecode)
)
const EOA_ADDR = '0x8DC9b3e1F5b0Dc9F6b2e0d3D0Ba0A5a32B0E7C4B'
const KEY_ADDR = '0x085f8A348f6fBc6F8d8FC3f1e427473436506D65'
const EXTERNAL_KEY_ADDR = '0x1A2C3802A9eC12725678dAF23DbFD13134e5893A'

const gcmPayload = (byteLength: number) => ({
  cipherType: CIPHER as 'AES-GCM',
  ciphertext: `0x${'ab'.repeat(byteLength)}`,
  iv: `0x${'cd'.repeat(12)}`
})

// The legacy main key is 16 bytes of key plus 16 bytes of iv, CTR encrypted and keccak maced
const ctrMainKeyPayload = () => ({
  cipherType: CIPHER_OLD as 'aes-128-ctr',
  ciphertext: `0x${'ab'.repeat(32)}`,
  iv: `0x${'cd'.repeat(16)}`,
  mac: `0x${'ef'.repeat(32)}`
})

const buildPayload = (): AccountsSyncPayload => ({
  v: ACCOUNTS_SYNC_PAYLOAD_VERSION,
  secret: {
    id: 'password',
    scryptParams: { salt: `0x${'ef'.repeat(32)}`, N: 131072, r: 8, p: 1, dkLen: 64 },
    aesEncrypted: gcmPayload(48)
  },
  accounts: [
    {
      addr: ACCOUNT_ADDR,
      associatedKeys: [KEY_ADDR],
      initialPrivileges: [
        [KEY_ADDR, '0x0000000000000000000000000000000000000000000000000000000000000002']
      ],
      creation: ACCOUNT_CREATION,
      preferences: { label: 'Account 1', pfp: ACCOUNT_ADDR }
    }
  ],
  keys: [
    {
      addr: KEY_ADDR,
      type: 'internal',
      label: 'Key 1',
      dedicatedToOneSA: true,
      meta: { createdAt: 1755000000000, fromSeedId: 'seed-1' },
      privKey: gcmPayload(48)
    },
    {
      addr: EXTERNAL_KEY_ADDR,
      type: 'ledger',
      label: 'Ledger Key 1',
      dedicatedToOneSA: false,
      meta: {
        deviceId: 'device-1',
        deviceModel: 'nanoX',
        hdPathTemplate: "m/44'/60'/0'/0/<account>",
        index: 0,
        createdAt: 1755000000000
      },
      privKey: null
    }
  ],
  seeds: [
    {
      id: 'seed-1',
      label: 'Recovery Phrase 1',
      hdPathTemplate: "m/44'/60'/0'/0/<account>",
      seed: gcmPayload(32),
      seedPassphrase: null
    }
  ]
})

const serializeAndParse = (payload: any) =>
  parseAccountsSyncPayload(getBytes(serializeAccountsSyncPayload(payload)))

describe('accountsSync payload', () => {
  it('round-trips a payload with internal keys, external keys and seeds', () => {
    const payload = buildPayload()

    expect(serializeAndParse(payload)).toEqual(payload)
  })

  it('rejects data that is not compressed at all', () => {
    expect(() => parseAccountsSyncPayload(new Uint8Array([1, 2, 3]))).toThrow(
      'failed to decompress the payload'
    )
  })

  it('rejects an uncompressed payload, which no Ambire product produces', () => {
    const uncompressed = toUtf8Bytes(JSON.stringify(buildPayload()))

    expect(() => parseAccountsSyncPayload(uncompressed)).toThrow('failed to decompress the payload')
  })

  it('rejects compressed data that is not a sync payload', () => {
    expect(() => parseAccountsSyncPayload(gzip(toUtf8Bytes('not json')))).toThrow(
      'not a valid sync payload'
    )
  })

  it('rejects a payload that decompresses to more than a sync payload could ever be', () => {
    // Compresses to a few KB but inflates past the 2MB limit, which is how a hostile QR
    // code would try to exhaust the memory of the device scanning it
    const bomb = gzip(new Uint8Array(3 * 1024 * 1024))

    expect(() => parseAccountsSyncPayload(bomb)).toThrow('too large to be a sync payload')
  })

  it('compresses the payload well below its JSON size', () => {
    const payload = buildPayload()
    const jsonSize = toUtf8Bytes(JSON.stringify(payload)).length
    // `serializeAccountsSyncPayload` returns a hex string, so 2 chars per wire byte
    const wireSize = (serializeAccountsSyncPayload(payload).length - 2) / 2

    expect(wireSize).toBeLessThan(jsonSize / 2)
  })

  it('rejects an unsupported payload version', () => {
    expect(() => serializeAndParse({ ...buildPayload(), v: 2 })).toThrow(
      'unsupported payload version 2'
    )
  })

  it('rejects a payload without the password protected main key', () => {
    const withBiometricsSecret = buildPayload()
    withBiometricsSecret.secret.id = 'biometrics'

    expect(() => serializeAndParse(withBiometricsSecret)).toThrow(
      'missing the password protected main key'
    )
  })

  it('rejects invalid scrypt params', () => {
    const payload: any = buildPayload()
    delete payload.secret.scryptParams.N

    expect(() => serializeAndParse(payload)).toThrow('invalid scrypt params')
  })

  it('rejects scrypt params that would make deriving the key allocate gigabytes', () => {
    const payload: any = buildPayload()
    payload.secret.scryptParams = { ...payload.secret.scryptParams, N: 2 ** 21, p: 64 }

    expect(() => serializeAndParse(payload)).toThrow('invalid scrypt params')
  })

  // A secret is only migrated to AES-GCM on an unlock that uses it, so a device that has
  // only ever unlocked with biometrics exports a main key that is still AES-CTR wrapped
  it('accepts a legacy AES-CTR wrapped main key', () => {
    const payload: any = buildPayload()
    payload.secret.aesEncrypted = ctrMainKeyPayload()

    expect(serializeAndParse(payload)).toEqual(payload)
  })

  it('rejects a legacy main key that is not the length the ciphers expect', () => {
    const shapes = [
      { ...ctrMainKeyPayload(), ciphertext: `0x${'ab'.repeat(31)}` },
      { ...ctrMainKeyPayload(), ciphertext: 'not hex at all' },
      { ...ctrMainKeyPayload(), iv: `0x${'cd'.repeat(12)}` },
      { ...ctrMainKeyPayload(), mac: `0x${'ef'.repeat(16)}` },
      { ...ctrMainKeyPayload(), mac: 'not hex at all' },
      { ...ctrMainKeyPayload(), mac: undefined }
    ]

    shapes.forEach((aesEncrypted) => {
      const payload: any = buildPayload()
      payload.secret.aesEncrypted = aesEncrypted

      expect(() => serializeAndParse(payload)).toThrow(
        'the main key is not a valid aes-128-ctr one'
      )
    })
  })

  it('rejects a legacy main key that does not say which cipher wraps it', () => {
    const payload: any = buildPayload()
    const withoutCipherType: any = ctrMainKeyPayload()
    delete withoutCipherType.cipherType
    payload.secret.aesEncrypted = withoutCipherType

    // `tryParseGcmPayload` treats a missing cipherType as a legacy string payload
    expect(() => serializeAndParse(payload)).toThrow(`the main key is not encrypted with ${CIPHER}`)
  })

  it('does not let a legacy main key relax the checks on the keys and seeds', () => {
    const withCtrKey: any = buildPayload()
    withCtrKey.secret.aesEncrypted = ctrMainKeyPayload()
    withCtrKey.keys[0].privKey = `0x${'ab'.repeat(48)}`

    expect(() => serializeAndParse(withCtrKey)).toThrow(`key ${KEY_ADDR} is not encrypted`)

    const withCtrSeed: any = buildPayload()
    withCtrSeed.secret.aesEncrypted = ctrMainKeyPayload()
    withCtrSeed.seeds[0].seed = `0x${'ab'.repeat(32)}`

    expect(() => serializeAndParse(withCtrSeed)).toThrow('seed seed-1 is not encrypted')
  })

  it('rejects a main key wrapped with a cipher no Ambire product knows', () => {
    const payload: any = buildPayload()
    payload.secret.aesEncrypted = { ...ctrMainKeyPayload(), cipherType: 'aes-256-cbc' }

    // `tryParseGcmPayload` rejects a known but unsupported cipher itself
    expect(() => serializeAndParse(payload)).toThrow('unsupported payload cipherType')
  })

  it('rejects a payload without accounts', () => {
    expect(() => serializeAndParse({ ...buildPayload(), accounts: [] })).toThrow(
      'no accounts in the payload'
    )
  })

  it('rejects an account with an invalid address', () => {
    const payload: any = buildPayload()
    payload.accounts[0].addr = '0xnot-an-address'

    expect(() => serializeAndParse(payload)).toThrow('invalid account addr')
  })

  it('rejects an account that does not match its creation data', () => {
    const payload: any = buildPayload()
    payload.accounts[0].creation = { ...ACCOUNT_CREATION, salt: `0x${'11'.repeat(32)}` }

    expect(() => serializeAndParse(payload)).toThrow(
      `account ${ACCOUNT_ADDR} does not match its creation data`
    )
  })

  it('rejects an account with a non-address in associatedKeys', () => {
    const payload: any = buildPayload()
    payload.accounts[0].associatedKeys = [KEY_ADDR, '0xnot-an-address']

    expect(() => serializeAndParse(payload)).toThrow('invalid account associatedKeys')
  })

  it('rejects an account with malformed initialPrivileges', () => {
    const payload: any = buildPayload()
    payload.accounts[0].initialPrivileges = [[KEY_ADDR, 'not-a-hex-privilege']]

    expect(() => serializeAndParse(payload)).toThrow('invalid account initialPrivileges')
  })

  it('accepts an EOA controlled by its own address', () => {
    const payload: any = buildPayload()
    payload.accounts[0] = {
      addr: EOA_ADDR,
      associatedKeys: [EOA_ADDR],
      initialPrivileges: [],
      creation: null,
      preferences: { label: 'Account 1', pfp: EOA_ADDR }
    }

    expect(serializeAndParse(payload)).toEqual(payload)
  })

  it('rejects an EOA that lists keys other than its own address', () => {
    const payload: any = buildPayload()
    payload.accounts[0] = {
      addr: EOA_ADDR,
      associatedKeys: [KEY_ADDR],
      initialPrivileges: [],
      creation: null,
      preferences: { label: 'Account 1', pfp: EOA_ADDR }
    }

    expect(() => serializeAndParse(payload)).toThrow(
      `account ${EOA_ADDR} has unexpected associatedKeys`
    )
  })

  it('rejects an internal key that is not AES-GCM encrypted', () => {
    const payload: any = buildPayload()
    payload.keys[0].privKey = '0xdeadbeef'

    expect(() => serializeAndParse(payload)).toThrow(
      `key ${KEY_ADDR} is not encrypted with AES-GCM`
    )
  })

  it('rejects an external key that carries a private key', () => {
    const payload: any = buildPayload()
    payload.keys[1].privKey = gcmPayload(48)

    expect(() => serializeAndParse(payload)).toThrow(
      `external key ${EXTERNAL_KEY_ADDR} has a privKey`
    )
  })

  it('rejects a seed that is not AES-GCM encrypted', () => {
    const payload: any = buildPayload()
    payload.seeds[0].seed = '0xdeadbeef'

    expect(() => serializeAndParse(payload)).toThrow('seed seed-1 is not encrypted with AES-GCM')
  })

  it('rejects a seed passphrase that is not AES-GCM encrypted', () => {
    const payload: any = buildPayload()
    payload.seeds[0].seedPassphrase = '0xdeadbeef'

    expect(() => serializeAndParse(payload)).toThrow(
      'seed passphrase seed-1 is not encrypted with AES-GCM'
    )
  })

  it('accepts a payload with no keys and no seeds (view-only accounts)', () => {
    const viewOnlyPayload = { ...buildPayload(), keys: [], seeds: [] }

    expect(serializeAndParse(viewOnlyPayload)).toEqual(viewOnlyPayload)
  })
})
