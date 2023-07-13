import { describe, expect, test } from '@jest/globals'
import { isAmbireV2 } from './accountState'
import { networks } from '../../consts/networks'
import { JsonRpcProvider } from 'ethers'
import { Account } from '../../interfaces/account'
const polygon = networks.find((x) => x.id === 'polygon')
if (!polygon) throw new Error('unable to find polygon network in consts')
const provider = new JsonRpcProvider(polygon.rpcUrl)

describe('AccountState', () => {
  test('should confirm v2 address is v2', async () => {
    const account: Account = {
      addr: '0x4B7155575CC01b0a65c1795c75ce12A81af0685d',
      label: 'test account',
      pfp: 'pfp',
      associatedKeys: [],
      creation: null
    }

    const isv2 = await isAmbireV2(provider, polygon, account)
    expect(isv2).toBeTruthy()
  })
  test('should confirm v1 address is not v2', async () => {
    const account: Account = {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      label: 'test account',
      pfp: 'pfp',
      associatedKeys: [],
      creation: null
    }

    const isv2 = await isAmbireV2(provider, polygon, account)
    expect(isv2).toBeFalsy()
  })
})
