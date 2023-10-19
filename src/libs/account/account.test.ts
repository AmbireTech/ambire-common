import { ethers } from 'ethers'
import { Account, AccountCreation } from 'interfaces/account'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import {
  getAccountDeployParams,
  getEmailAccount,
  getLegacyAccount,
  getSmartAccount
} from './account'

const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

const legacyAccount: Account = {
  addr: keyPublicAddress,
  label: '',
  pfp: '',
  associatedKeys: [keyPublicAddress],
  privileges: [],
  creation: null
}

describe('Account', () => {
  test('should return legacyAccount', () => {
    expect.assertions(1)
    const newLegacyAccount = getLegacyAccount(keyPublicAddress)
    expect(newLegacyAccount as Account).toStrictEqual(legacyAccount)
  })
  test('should return smartAccount', async () => {
    expect.assertions(3)
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
    const newSmartAccount = await getSmartAccount([priv])
    const bytecode = await getBytecode([priv])
    const accountNotDeployed = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
      label: '',
      pfp: '',
      associatedKeys: [keyPublicAddress],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(0, 32)
      }
    }
    expect(newSmartAccount as Account).toStrictEqual(accountNotDeployed)
    expect(newSmartAccount.creation as AccountCreation).not.toBe(null)
    expect(newSmartAccount.associatedKeys[0]).toBe(keyPublicAddress)
  })
  test('should fail to return deploy params if legacy account is passed', async () => {
    expect.assertions(1)
    try {
      getAccountDeployParams(legacyAccount)
    } catch (e: any) {
      expect(e.message).toBe('tried to get deployment params for an EOA')
    }
  })
  test('should return account deploy params', async () => {
    expect.assertions(1)
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
    const bytecode = await getBytecode([priv])
    const accountNotDeployed: Account = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
      label: '',
      pfp: '',
      associatedKeys: [keyPublicAddress],
      privileges: [[priv.addr, priv.hash]],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(0, 32)
      }
    }
    const accountData = getAccountDeployParams(accountNotDeployed)
    expect(accountData as any).toEqual([
      AMBIRE_ACCOUNT_FACTORY,
      '0x9c4ae2d000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007a7f00000000000000000000000000000000000000000000000000000000000000017fbacd3e9e8aed42b26f997f28d90ae31f73d67222ec769cf7d8552e5f95f8f48d553d602d80604d3d3981f3363d3d373d3d3d363d73ff69afde895b381ee71e17c60350ae4c70b16a925af43d82803e903d91602b57fd5bf3000000000000'
    ])
  })
  test('should return a gmail emailAccount successfully', async () => {
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
    const newSmartAccount = await getEmailAccount(
      {
        emailFrom: 'tt469695@gmail.com',
        secondaryKey: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
      },
      [priv]
    )

    expect(newSmartAccount.associatedKeys.length).toBe(2)
  })
  test('should return an ambire emailAccount successfully', async () => {
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
    const newSmartAccount = await getEmailAccount(
      {
        emailFrom: 'test@ambire.com',
        secondaryKey: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
      },
      [priv]
    )

    expect(newSmartAccount.associatedKeys.length).toBe(2)
  })
  test('should return an email account that does not have a dkim key', async () => {
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
    const newSmartAccount = await getEmailAccount(
      {
        emailFrom: 'test@izmislen.com',
        secondaryKey: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
      },
      [priv]
    )

    expect(newSmartAccount.associatedKeys.length).toBe(2)
  })
})
