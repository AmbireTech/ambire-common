import { ethers } from 'ethers'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Account, AccountCreation } from '../../interfaces/account'
import { fullSigningPriv } from '../../interfaces/keystore'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { getAccountDeployParams, getLegacyAccount, getSmartAccount } from './account'

const polygon = networks.find((x) => x.id === 'polygon')
if (!polygon) throw new Error('unable to find polygon network in consts')
const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

const legacyAccount: Account = {
  addr: keyPublicAddress,
  associatedKeys: [keyPublicAddress],
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
    const newSmartAccount = await getSmartAccount([
      { addr: keyPublicAddress, hash: fullSigningPriv }
    ])
    const priv = {
      addr: keyPublicAddress,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
    }
    const bytecode = await getBytecode(polygon, [priv])
    const accountNotDeployed = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
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
    const priv = { addr: keyPublicAddress, hash: true }
    const bytecode = await getBytecode(polygon, [priv])
    const accountNotDeployed = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
      associatedKeys: [keyPublicAddress],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(0, 32)
      }
    }
    const accountData = getAccountDeployParams(accountNotDeployed)
    expect(accountData as any).toEqual([
      AMBIRE_ACCOUNT_FACTORY,
      '0x9c4ae2d000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005b60017fbacd3e9e8aed42b26f997f28d90ae31f73d67222ec769cf7d8552e5f95f8f48d553d602d80602e3d3981f3363d3d373d3d3d363d7353a31973ebcc225e219bb0d7c0c9324773f5b3e95af43d82803e903d91602b57fd5bf30000000000'
    ])
  })
})
