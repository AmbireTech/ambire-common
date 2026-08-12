import { getBytes } from 'ethers'

import { CIPHER } from '@/libs/keystore/keystore'

import {
  ACCOUNTS_SYNC_PAYLOAD_VERSION,
  AccountsSyncPayload,
  parseAccountsSyncPayload,
  serializeAccountsSyncPayload
} from './accountsSync'

const ACCOUNT_ADDR = '0x8DC9b3e1F5b0Dc9F6b2e0d3D0Ba0A5a32B0E7C4B'
const KEY_ADDR = '0x085f8A348f6fBc6F8d8FC3f1e427473436506D65'
const EXTERNAL_KEY_ADDR = '0x1A2C3802A9eC12725678dAF23DbFD13134e5893A'

const gcmPayload = (byteLength: number) => ({
  cipherType: CIPHER as 'AES-GCM',
  ciphertext: `0x${'ab'.repeat(byteLength)}`,
  iv: `0x${'cd'.repeat(12)}`
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
      creation: {
        factoryAddr: '0xa8202f888b9b2dFA5Ceb2204865018133F6F179A',
        bytecode: `0x${'60'.repeat(120)}`,
        salt: `0x${'00'.repeat(32)}`
      },
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

  it('rejects data that is not a sync payload', () => {
    expect(() => parseAccountsSyncPayload(new Uint8Array([1, 2, 3]))).toThrow(
      'not a valid sync payload'
    )
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

  it('rejects a main key that is not AES-GCM encrypted', () => {
    const payload: any = buildPayload()
    payload.secret.aesEncrypted = {
      cipherType: 'aes-128-ctr',
      ciphertext: '0xabab',
      iv: '0xcdcd',
      mac: '0xefef'
    }

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
