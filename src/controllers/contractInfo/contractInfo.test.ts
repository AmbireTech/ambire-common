import fetch from 'node-fetch'

import { IContractInfoController, SelectorsFromStorage } from '@/interfaces/contractInfo'
import wait from '@/utils/wait'
import { expect } from '@jest/globals'
import { produceMemoryStore } from '@test/helpers'

import { suppressConsole } from '../../../test/helpers/console'
import { makeMainController } from '../../../test/helpers/mainController'
import { Session } from '../../classes/session'
import { predefinedDapps } from '../../consts/dapps/dapps'
import mockChains from '../../consts/dapps/mockChains'
import mockDapps from '../../consts/dapps/mockDapps'
import { IStorageController } from '../../interfaces/storage'
import { DappConnectRequest } from '../../interfaces/userRequest'
import { EventEmitterRegistryController } from '../eventEmitterRegistry/eventEmitterRegistry'
import { StorageController } from '../storage/storage'
import { ContractInfo, FUNCTION_SELECTORS_STORAGE_KEY } from './contractInfo'

let fetchSpy: any
let contractInfoController: IContractInfoController
let storage: IStorageController
const PREDEFINED_SELECTORS = {
  '0x23b872dd': [
    {
      signature: 'transferFrom(address,address,uint256)'
    },
    {
      signature: '__$_$__$$$$$__$$_$$$_$$__$$___$$(address,address,uint256)'
    },
    {
      signature: 'seaportCallback4878572495(address,address,uint256)'
    },
    {
      signature:
        'func_801zDya(address,address,uint256,((address,uint256),uint256,uint256),bytes32,bytes)'
    },
    {
      signature: 'func_60iHVgK(address,address,uint256,uint256,address)'
    },
    {
      signature: 'gasprice_bit_ether(int128)'
    },
    {
      signature: 'watch_tg_invmru_faebe36(bool,bool,bool)'
    },
    {
      signature: 'func_nZHTch(address,address,uint256,((address,uint256),uint256,uint256),bytes)'
    },
    {
      signature: 'func_chVsN(address,address,uint256,address,uint256,uint256,uint256,bytes)'
    }
  ],
  '0xa9059cbb': [
    {
      signature: 'transfer(address,uint256)'
    },
    {
      signature: '_____$_$__$___$$$___$$___$__$$(address,uint256)'
    },
    {
      signature: 'many_msg_babbage(bytes1)'
    },
    {
      signature: 'transfer(bytes4[9],bytes5[6],int48[11])'
    },
    {
      signature: 'func_2093253501(bytes)'
    },
    {
      signature: 'workMyDirefulOwner(uint256,uint256)'
    },
    {
      signature: 'join_tg_invmru_haha_fd06787(address,bool)'
    },
    {
      signature: 'fakeTransfer_4570999670(bytes)'
    },
    {
      signature: 'transfer3112631958((address,uint256,bytes)[])'
    }
  ]
}
beforeEach(async () => {
  const realFetch = global.fetch
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((...args) => realFetch(...args))

  const eventEmitterRegistry = new EventEmitterRegistryController(() => null)
  storage = new StorageController(produceMemoryStore(), eventEmitterRegistry)
  await storage.set('functionSelectors', {
    '0x095ea7b3': [{ signature: 'approve(address,uint256)' }]
  } as SelectorsFromStorage)

  contractInfoController = new ContractInfo({
    fetch: fetchSpy,
    eventEmitterRegistry,
    storage
  })
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('ContractInfoController', () => {
  test('Should read selectors from storage', async () => {
    await contractInfoController.initialLoadPromise
    expect(contractInfoController.selectors?.['0x095ea7b3']).toMatchObject({
      status: 'success',
      data: [{ signature: 'approve(address,uint256)' }]
    })
  })
  test('Should debounce when in quick succession', async () => {
    await contractInfoController.initialLoadPromise
    contractInfoController.getSelector('0x23b872dd')
    contractInfoController.getSelector('0xa9059cbb')
    expect(contractInfoController.selectors?.['0x23b872dd']?.status).toBe('loading')
    expect(contractInfoController.selectors?.['0xa9059cbb']?.status).toBe('loading')
    await wait(3000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(contractInfoController.selectors?.['0x23b872dd']).toMatchObject({
      status: 'success',
      data: PREDEFINED_SELECTORS['0x23b872dd']
    })
    expect(contractInfoController.selectors?.['0xa9059cbb']).toMatchObject({
      status: 'success',
      data: PREDEFINED_SELECTORS['0xa9059cbb']
    })
    // should not double fetch
    contractInfoController.getSelector('0x23b872dd')
    await wait(3000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('Should store selectors in storage correctly', async () => {
    await contractInfoController.initialLoadPromise
    contractInfoController.getSelector('0x40c10f19')
    await wait(3000)
    let storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    expect(storedSelectors['0x40c10f19']).toMatchObject([
      { signature: 'mint(address,uint256)' },
      { signature: 'cat642998653(address,uint256)' }
    ])
  })
})
