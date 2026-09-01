import {
  BIP44_LEDGER_DERIVATION_TEMPLATE,
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  BIP44_STANDARD_TESTNET_DERIVATION_TEMPLATE,
  LEGACY_POPULAR_DERIVATION_TEMPLATE
} from '../consts/derivation'
import { getDerivableHdPathTemplates, getHdPathTemplateRelativeToOrigin } from './hdPath'

const ACCOUNT_LEVEL_PATH = "m/44'/60'/0'"
const CHAIN_LEVEL_PATH = "m/44'/60'/0'/0"

describe('getHdPathTemplateRelativeToOrigin', () => {
  it('resolves the paths that branch off an account level key', () => {
    expect(
      getHdPathTemplateRelativeToOrigin(ACCOUNT_LEVEL_PATH, BIP44_STANDARD_DERIVATION_TEMPLATE)
    ).toBe('0/<account>')
    expect(
      getHdPathTemplateRelativeToOrigin(ACCOUNT_LEVEL_PATH, LEGACY_POPULAR_DERIVATION_TEMPLATE)
    ).toBe('<account>')
  })

  it('resolves the standard path from a chain level key', () => {
    expect(
      getHdPathTemplateRelativeToOrigin(CHAIN_LEVEL_PATH, BIP44_STANDARD_DERIVATION_TEMPLATE)
    ).toBe('<account>')
  })

  it('refuses a path with a hardened index below the origin', () => {
    expect(
      getHdPathTemplateRelativeToOrigin(ACCOUNT_LEVEL_PATH, BIP44_LEDGER_DERIVATION_TEMPLATE)
    ).toBeNull()
  })

  it('refuses a path on another branch', () => {
    expect(
      getHdPathTemplateRelativeToOrigin(
        ACCOUNT_LEVEL_PATH,
        BIP44_STANDARD_TESTNET_DERIVATION_TEMPLATE
      )
    ).toBeNull()
    expect(
      getHdPathTemplateRelativeToOrigin(CHAIN_LEVEL_PATH, LEGACY_POPULAR_DERIVATION_TEMPLATE)
    ).toBeNull()
  })

  it('refuses a path that is the origin itself', () => {
    expect(
      getHdPathTemplateRelativeToOrigin(ACCOUNT_LEVEL_PATH, ACCOUNT_LEVEL_PATH as any)
    ).toBeNull()
  })
})

describe('getDerivableHdPathTemplates', () => {
  it('offers the standard and the legacy path for an account level key', () => {
    expect(getDerivableHdPathTemplates(ACCOUNT_LEVEL_PATH)).toEqual([
      BIP44_STANDARD_DERIVATION_TEMPLATE,
      LEGACY_POPULAR_DERIVATION_TEMPLATE
    ])
  })

  it('offers only the standard path for a chain level key', () => {
    expect(getDerivableHdPathTemplates(CHAIN_LEVEL_PATH)).toEqual([
      BIP44_STANDARD_DERIVATION_TEMPLATE
    ])
  })
})
