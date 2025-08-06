import { ethers, ZeroAddress } from 'ethers'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { Account, AccountCreation, AccountOnPage, ImportStatus } from '../../interfaces/account'
import { dedicatedToOneSAPriv, Key } from '../../interfaces/keystore'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import {
  getAccountDeployParams,
  getAccountImportStatus,
  getBasicAccount,
  getEmailAccount,
  getSmartAccount
} from './account'

const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

const basicAccount: Account = {
  addr: keyPublicAddress,
  associatedKeys: [keyPublicAddress],
  initialPrivileges: [],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: keyPublicAddress
  }
}

describe('Account', () => {
  test('should return EOA', () => {
    expect.assertions(1)
    const newBasicAccount = getBasicAccount(keyPublicAddress, [])
    expect(newBasicAccount as Account).toStrictEqual(basicAccount)
  })
  test('should return smartAccount', async () => {
    expect.assertions(3)
    const priv = {
      addr: keyPublicAddress,
      hash: dedicatedToOneSAPriv
    }
    const newSmartAccount = await getSmartAccount([priv], [])
    const bytecode = await getBytecode([priv])
    const accountNotDeployed = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
      associatedKeys: [keyPublicAddress],
      initialPrivileges: [[priv.addr, priv.hash]],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(0, 32)
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)
      }
    }
    expect(newSmartAccount as Account).toStrictEqual(accountNotDeployed)
    expect(newSmartAccount.creation as AccountCreation).not.toBe(null)
    expect(newSmartAccount.associatedKeys[0]).toBe(keyPublicAddress)
  })
  test('should return zero address and 0x deploy data if EOA is passed', async () => {
    expect.assertions(1)
    const accountData = getAccountDeployParams(basicAccount)
    expect(accountData as any).toEqual([ZeroAddress, '0x'])
  })
  test('should return account deploy params', async () => {
    expect.assertions(1)
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
    const bytecode = await getBytecode([priv])

    const addr = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)
    const accountNotDeployed: Account = {
      addr,
      associatedKeys: [priv.addr],
      initialPrivileges: [[priv.addr, priv.hash]],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(1, 32)
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: addr
      }
    }
    const accountData = getAccountDeployParams(accountNotDeployed)
    expect(accountData as any).toEqual([
      AMBIRE_ACCOUNT_FACTORY,
      '0x9c4ae2d000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000007a7f00000000000000000000000000000000000000000000000000000000000000017fbacd3e9e8aed42b26f997f28d90ae31f73d67222ec769cf7d8552e5f95f8f48d553d602d80604d3d3981f3363d3d373d3d3d363d730f2aa7bcda3d9d210df69a394b6965cb2566c8285af43d82803e903d91602b57fd5bf3000000000000'
    ])
  })
  test('should return a gmail emailAccount successfully', async () => {
    const newSmartAccount = await getEmailAccount(
      {
        emailFrom: 'tt469695@gmail.com',
        secondaryKey: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
      },
      keyPublicAddress
    )

    expect(newSmartAccount.associatedKeys.length).toBe(1)
    expect(newSmartAccount.associatedKeys[0]).toBe(keyPublicAddress)
  })
  test('should return an ambire emailAccount successfully', async () => {
    const newSmartAccount = await getEmailAccount(
      {
        emailFrom: 'test@ambire.com',
        secondaryKey: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
      },
      keyPublicAddress
    )

    expect(newSmartAccount.associatedKeys.length).toBe(1)
    expect(newSmartAccount.associatedKeys[0]).toBe(keyPublicAddress)
  })
  test('should return an email account that does not have a dkim key', async () => {
    const newSmartAccount = await getEmailAccount(
      {
        emailFrom: 'test@izmislen.com',
        secondaryKey: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
      },
      keyPublicAddress
    )

    expect(newSmartAccount.associatedKeys.length).toBe(1)
    expect(newSmartAccount.associatedKeys[0]).toBe(keyPublicAddress)
  })
  test('Should resolve EOA import status to ImportStatus.ImportedWithTheSameKeys or ImportStatus.ImportedWithDifferentKeys', () => {
    const key: Key = {
      addr: basicAccount.addr,
      type: 'internal',
      label: 'Key 1',
      dedicatedToOneSA: false,
      meta: {
        createdAt: new Date().getTime()
      },
      isExternallyStored: false
    }
    const accountsOnPage: Omit<AccountOnPage, 'importStatus'>[] = [
      {
        account: {
          ...basicAccount,
          usedOnNetworks: []
        },
        slot: 1,
        index: 0,
        isLinked: false
      }
    ]

    expect(
      getAccountImportStatus({
        account: basicAccount,
        alreadyImportedAccounts: [basicAccount],
        keys: [key],
        accountsOnPage,
        keyIteratorType: 'internal'
      })
    ).toBe(ImportStatus.ImportedWithTheSameKeys)

    expect(
      getAccountImportStatus({
        account: basicAccount,
        alreadyImportedAccounts: [basicAccount],
        keys: [key],
        accountsOnPage,
        keyIteratorType: 'ledger'
      })
    ).toBe(ImportStatus.ImportedWithDifferentKeys)
  })
  test('Should resolve Smart account import status to either ImportStatus.ImportedWithTheSameKeys, ImportStatus.ImportedWithDifferentKeys or ImportStatus.ImportedWithSomeOfTheKeys', async () => {
    const priv = {
      addr: keyPublicAddress,
      hash: dedicatedToOneSAPriv
    }
    const smartAccount = await getSmartAccount([priv], [])
    const key: Key = {
      addr: basicAccount.addr,
      type: 'trezor',
      dedicatedToOneSA: true,
      label: 'Key 1',
      meta: {
        deviceId: '123',
        deviceModel: '1',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        index: 0,
        createdAt: new Date().getTime()
      },
      isExternallyStored: false
    }
    const accountsOnPage: Omit<AccountOnPage, 'importStatus'>[] = [
      {
        account: {
          ...basicAccount,
          usedOnNetworks: []
        },
        slot: 1,
        index: 0,
        isLinked: false
      },
      {
        account: {
          ...smartAccount,
          usedOnNetworks: []
        },
        slot: 1,
        index: 0,
        isLinked: false
      }
    ]

    expect(
      getAccountImportStatus({
        account: smartAccount,
        alreadyImportedAccounts: [smartAccount],
        keys: [key],
        accountsOnPage,
        keyIteratorType: 'trezor'
      })
    ).toBe(ImportStatus.ImportedWithTheSameKeys)

    expect(
      getAccountImportStatus({
        account: smartAccount,
        alreadyImportedAccounts: [smartAccount],
        keys: [key],
        accountsOnPage,
        keyIteratorType: 'internal'
      })
    ).toBe(ImportStatus.ImportedWithDifferentKeys)
  })

  test('Should use merged associatedKeys (one in storage and one incoming from the account found on page), should detect differences in the associatedKeys and should detect different scenarios with having associatedKeys and imported keys alongside', async () => {
    const priv = {
      addr: keyPublicAddress,
      hash: dedicatedToOneSAPriv
    }
    const smartAccountWithIncompleteAssociatedKeys = await getSmartAccount([priv], [])

    const oneOfTheSmartAccountKeys: Key = {
      addr: basicAccount.addr,
      type: 'trezor',
      dedicatedToOneSA: true,
      label: 'Key 1',
      meta: {
        deviceId: '123',
        deviceModel: '1',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        index: 0,
        createdAt: new Date().getTime()
      },
      isExternallyStored: false
    }
    const anotherBasicAccount: Account = {
      // random ethereum address
      addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      associatedKeys: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
      initialPrivileges: [],
      creation: null,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      }
    }

    const anotherBasicAccountKeyWithTheSameKeyType: Key = {
      addr: anotherBasicAccount.addr,
      type: 'trezor',
      dedicatedToOneSA: false,
      label: 'Key 1',
      meta: {
        deviceId: '123',
        deviceModel: '1',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        index: 1,
        createdAt: new Date().getTime()
      },
      isExternallyStored: false
    }

    const anotherBasicAccountKeyWithDifferentKeyType: Key = {
      addr: anotherBasicAccount.addr,
      type: 'internal',
      label: 'Key 1',
      dedicatedToOneSA: false,
      meta: {
        createdAt: new Date().getTime()
      },
      isExternallyStored: false
    }

    const accountsOnPageWithUpToDateAssociatedKeys: Omit<AccountOnPage, 'importStatus'>[] = [
      {
        account: { ...anotherBasicAccount, usedOnNetworks: [] },
        slot: 1,
        index: 0,
        isLinked: false
      },
      {
        account: {
          ...smartAccountWithIncompleteAssociatedKeys,
          associatedKeys: [
            ...smartAccountWithIncompleteAssociatedKeys.associatedKeys,
            // Include another (a new one) associated key!
            anotherBasicAccountKeyWithTheSameKeyType.addr
          ],
          usedOnNetworks: []
        },
        slot: 1,
        index: 0,
        isLinked: true
      }
    ]

    expect(
      getAccountImportStatus({
        account: smartAccountWithIncompleteAssociatedKeys,
        alreadyImportedAccounts: [smartAccountWithIncompleteAssociatedKeys],
        keys: [oneOfTheSmartAccountKeys],
        accountsOnPage: accountsOnPageWithUpToDateAssociatedKeys,
        keyIteratorType: 'trezor'
      })
    ).toBe(ImportStatus.ImportedWithSomeOfTheKeys)

    expect(
      getAccountImportStatus({
        account: smartAccountWithIncompleteAssociatedKeys,
        alreadyImportedAccounts: [smartAccountWithIncompleteAssociatedKeys],
        // Similar scenario, but both keys already previously imported!
        // Should still return ImportedWithSomeOfTheKeys,
        // because the associated keys are not up-to-date.
        keys: [oneOfTheSmartAccountKeys, anotherBasicAccountKeyWithTheSameKeyType],
        accountsOnPage: accountsOnPageWithUpToDateAssociatedKeys,
        // same key iterator type as the `oneOfTheSmartAccountKeys`
        keyIteratorType: 'trezor'
      })
    ).toBe(ImportStatus.ImportedWithSomeOfTheKeys)

    expect(
      getAccountImportStatus({
        account: smartAccountWithIncompleteAssociatedKeys,
        alreadyImportedAccounts: [smartAccountWithIncompleteAssociatedKeys],
        // Similar scenario, but both keys already previously imported!
        // Should still return ImportedWithSomeOfTheKeys,
        // because the associated keys are not up-to-date.
        keys: [oneOfTheSmartAccountKeys, anotherBasicAccountKeyWithTheSameKeyType],
        accountsOnPage: accountsOnPageWithUpToDateAssociatedKeys,
        // Same key iterator type as `anotherBasicAccountKeyWithTheSameKeyType`
        // (that is different from `oneOfTheSmartAccountKeys`)
        keyIteratorType: 'internal'
      })
    ).toBe(ImportStatus.ImportedWithDifferentKeys)

    expect(
      getAccountImportStatus({
        account: smartAccountWithIncompleteAssociatedKeys,
        alreadyImportedAccounts: [smartAccountWithIncompleteAssociatedKeys],
        // Similar scenario, but both keys already previously imported!
        // Should still return ImportedWithSomeOfTheKeys,
        // because the associated keys are not up-to-date.
        keys: [oneOfTheSmartAccountKeys, anotherBasicAccountKeyWithDifferentKeyType],
        accountsOnPage: accountsOnPageWithUpToDateAssociatedKeys,
        // Different key iterator type as the `oneOfTheSmartAccountKeys`
        keyIteratorType: 'internal'
      })
    ).toBe(ImportStatus.ImportedWithDifferentKeys)

    expect(
      getAccountImportStatus({
        account: smartAccountWithIncompleteAssociatedKeys,
        alreadyImportedAccounts: [smartAccountWithIncompleteAssociatedKeys],
        // Similar scenario, but both keys already previously imported!
        // Should still return ImportedWithSomeOfTheKeys,
        // because the associated keys are not up-to-date.
        keys: [oneOfTheSmartAccountKeys, anotherBasicAccountKeyWithDifferentKeyType],
        accountsOnPage: accountsOnPageWithUpToDateAssociatedKeys,
        // completely different key iterator than both keys found!
        keyIteratorType: 'ledger'
      })
    ).toBe(ImportStatus.ImportedWithDifferentKeys)
  })

  test('Should resolve view only account import status to ImportStatus.ImportedWithoutKey', () => {
    const accountsOnPage: Omit<AccountOnPage, 'importStatus'>[] = [
      {
        account: {
          ...basicAccount,
          usedOnNetworks: []
        },
        slot: 1,
        index: 0,
        isLinked: false
      }
    ]

    expect(
      getAccountImportStatus({
        account: basicAccount,
        alreadyImportedAccounts: [basicAccount],
        keys: [],
        accountsOnPage,
        keyIteratorType: 'internal'
      })
    ).toBe(ImportStatus.ImportedWithoutKey)
  })

  test('Should resolve the import status of an account that has not been imported yet to ImportStatus.NotImported', () => {
    const accountsOnPage: Omit<AccountOnPage, 'importStatus'>[] = [
      {
        account: {
          ...basicAccount,
          usedOnNetworks: []
        },
        slot: 1,
        index: 0,
        isLinked: false
      }
    ]

    expect(
      getAccountImportStatus({
        account: basicAccount,
        alreadyImportedAccounts: [],
        keys: [],
        accountsOnPage,
        keyIteratorType: 'internal'
      })
    ).toBe(ImportStatus.NotImported)
  })
})
