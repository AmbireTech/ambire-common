import { Selectors } from '@/interfaces/contractInfo'
import wait from '@/utils/wait'
import { expect } from '@jest/globals'
import { makeMainController } from '@test/helpers/mainController'

import { FUNCTION_SELECTORS_STORAGE_KEY, SELECTOR_SUCCESS_DEADLINE_MS } from './contractInfo'

const CENA_SELECTORS_URL = 'https://cena.ambire.com/api/v3/contracts/selectors'

let fetchSpy: any
const PREDEFINED_SELECTORS: Selectors = {
  '0x23b872dd': {
    data: [
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
    updatedAt: 0,
    status: 'success'
  },
  '0xa9059cbb': {
    data: [
      {
        signature: 'transfer(address,uint256)'
      },
      {
        signature: '_____$_$__$___$$$___$$___$__$$(address,uint256)'
      },
      {
        signature: 'join_tg_invmru_haha_fd06787(address,bool)'
      },
      {
        signature: 'func_2093253501(bytes)'
      },
      {
        signature: 'transfer(bytes4[9],bytes5[6],int48[11])'
      },
      {
        signature: 'many_msg_babbage(bytes1)'
      },
      {
        signature: 'workMyDirefulOwner(uint256,uint256)'
      },
      {
        signature: 'fakeTransfer_4570999670(bytes)'
      },
      {
        signature: 'transfer3112631958((address,uint256,bytes)[])'
      },
      {
        signature: 'z75000129682300((address,uint256,bytes)[])'
      },
      {
        signature: 'z81250554928297((address,bytes)[])'
      }
    ],
    status: 'success',
    updatedAt: 0
  }
}
let fetchSourcifyCounter = 0
beforeEach(async () => {
  const realFetch = global.fetch
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((...args): any => {
    if ((args[0] as string).includes(CENA_SELECTORS_URL)) fetchSourcifyCounter += 1
    return realFetch(...args)
  })
})

afterEach(() => {
  fetchSourcifyCounter = 0
  fetchSpy.mockRestore()
})

describe('contractInfo', () => {
  test('Should read selectors from storage', async () => {
    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(
      async (storage) => {
        await storage.set('functionSelectors', {
          '0x095ea7b3': {
            status: 'success',
            data: [{ signature: 'approve(address,uint256)' }],
            updatedAt: Date.now()
          }
        })
      },
      { overrides: { fetch: fetchSpy } }
    )
    expect(contractInfo.selectors?.['0x095ea7b3']).toMatchObject({
      status: 'success',
      data: [{ signature: 'approve(address,uint256)' }]
    })
  })
  test('Should debounce when in quick succession', async () => {
    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(undefined, { overrides: { fetch: fetchSpy } })
    void contractInfo.getSelector('0x23b872dd')
    void contractInfo.getSelector('0xa9059cbb')
    expect(contractInfo.selectors?.['0x23b872dd']?.status).toBe('loading')
    expect(contractInfo.selectors?.['0xa9059cbb']?.status).toBe('loading')
    await wait(3000)
    expect(fetchSourcifyCounter).toBe(1)
    expect(contractInfo.selectors?.['0x23b872dd']?.status).toBe('success')
    expect((contractInfo.selectors?.['0x23b872dd'] as any).data).toMatchObject(
      (PREDEFINED_SELECTORS['0x23b872dd'] as any).data
    )
    expect(contractInfo.selectors?.['0x23b872dd']?.updatedAt).toBeTruthy()

    expect(contractInfo.selectors?.['0xa9059cbb']?.status).toBe('success')
    expect((contractInfo.selectors?.['0xa9059cbb'] as any).data).toMatchObject(
      (PREDEFINED_SELECTORS['0xa9059cbb'] as any).data
    )
    expect(contractInfo.selectors?.['0xa9059cbb']?.updatedAt).toBeTruthy()

    // should not double fetch
    void contractInfo.getSelector('0x23b872dd')
    await wait(3000)
    expect(fetchSourcifyCounter).toBe(1)
  })

  test('Should store selectors in storage correctly', async () => {
    const {
      mainCtrl: { contractInfo, storage }
    } = await makeMainController()

    void contractInfo.getSelector('0x40c10f19')
    await wait(3000)
    const storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    expect((storedSelectors['0x40c10f19'] as any).data).toMatchObject([
      { signature: 'mint(address,uint256)' },
      { signature: 'cat642998653(address,uint256)' }
    ])
    expect(storedSelectors['0x40c10f19']!.status).toBe('success')
  })
  test('Should not override an existing selector when fetching is disabled', async () => {
    const {
      mainCtrl: { contractInfo, featureFlags }
    } = await makeMainController(
      async (storage) => {
        await storage.set(FUNCTION_SELECTORS_STORAGE_KEY, {
          '0x23b872dd': {
            status: 'success',
            data: [{ signature: 'transferFrom(address,address,uint256)' }],
            updatedAt: Date.now()
          }
        })
      },
      { overrides: { fetch: fetchSpy } }
    )

    void featureFlags.setFeatureFlag('apiForFunctionSelectors', false)
    void contractInfo.getSelector('0x23b872dd')
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('success')
    expect((contractInfo.selectors['0x23b872dd'] as any).data).toMatchObject([
      { signature: 'transferFrom(address,address,uint256)' }
    ])
    await wait(3000)
    expect(fetchSourcifyCounter).toBe(0)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('success')
  })

  test('Should not fetch selectors when apiForFunctionSelectors feature flag is disabled', async () => {
    const {
      mainCtrl: { contractInfo, featureFlags }
    } = await makeMainController(undefined, { overrides: { fetch: fetchSpy } })

    void featureFlags.setFeatureFlag('apiForFunctionSelectors', false)
    void contractInfo.getSelector('0x23b872dd')
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('fetching-disabled')
    await wait(3000)
    expect(fetchSourcifyCounter).toBe(0)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('fetching-disabled')
  })

  test('Should not re-fetch a selector with a fresh updatedAt', async () => {
    let cenaCalls = 0
    const trackingFetch = (url: any, ...args: any[]) => {
      if ((url as string).includes(CENA_SELECTORS_URL)) cenaCalls++
      return fetchSpy(url, ...args)
    }

    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(
      async (storage) => {
        await storage.set(FUNCTION_SELECTORS_STORAGE_KEY, {
          '0x23b872dd': {
            status: 'success',
            data: [{ signature: 'transferFrom(address,address,uint256)' }],
            updatedAt: Date.now()
          }
        })
      },
      { overrides: { fetch: trackingFetch } }
    )

    void contractInfo.getSelector('0x23b872dd')
    await wait(200)
    expect(cenaCalls).toBe(0)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('success')
  })

  test('Should fetch successfully, respect fetching-disabled when flag is off, then re-fetch when flag is re-enabled', async () => {
    let cenaCalls = 0
    const trackingFetch = (url: any, ...args: any[]) => {
      if ((url as string).includes(CENA_SELECTORS_URL)) cenaCalls++
      return fetchSpy(url, ...args)
    }

    const {
      mainCtrl: { contractInfo, featureFlags }
    } = await makeMainController(undefined, { overrides: { fetch: trackingFetch } })

    // Step 1: fetch successfully with flag enabled (default)
    void contractInfo.getSelector('0x23b872dd')
    await wait(3000)
    expect(cenaCalls).toBe(1)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('success')
    expect((contractInfo.selectors['0x23b872dd'] as any).data).toMatchObject(
      (PREDEFINED_SELECTORS['0x23b872dd'] as any).data
    )

    // Step 2: disable the feature flag
    await featureFlags.setFeatureFlag('apiForFunctionSelectors', false)

    // Step 3: attempt to fetch a new selector while flag is disabled — no network call, status marked as fetching-disabled
    void contractInfo.getSelector('0xa9059cbb')
    expect(contractInfo.selectors['0xa9059cbb']?.status).toBe('fetching-disabled')

    await wait(3000)
    expect(cenaCalls).toBe(1)
    expect(contractInfo.selectors['0xa9059cbb']?.status).toBe('fetching-disabled')

    // Step 4: re-enable the feature flag
    await featureFlags.setFeatureFlag('apiForFunctionSelectors', true)

    // Step 5: call getSelector for the previously-disabled selector — it should now be fetched
    void contractInfo.getSelector('0xa9059cbb')
    expect(contractInfo.selectors['0xa9059cbb']?.status).toBe('loading')

    await wait(3000)
    expect(cenaCalls).toBe(2)
    expect(contractInfo.selectors['0xa9059cbb']?.status).toBe('success')
    expect((contractInfo.selectors['0xa9059cbb'] as any).data).toMatchObject(
      (PREDEFINED_SELECTORS['0xa9059cbb'] as any).data
    )
  })

  test('Should preserve data after expired cache + failed refetch, and skip reattempt while error is recent', async () => {
    let cenaCalls = 0
    const failingFetch = (url: any, ...args: any[]) => {
      if ((url as string).includes(CENA_SELECTORS_URL)) {
        cenaCalls++
        return Promise.reject(new Error('Network error'))
      }
      return fetchSpy(url, ...args)
    }

    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(
      async (storage) => {
        await storage.set(FUNCTION_SELECTORS_STORAGE_KEY, {
          '0x23b872dd': {
            status: 'success',
            data: [{ signature: 'transferFrom(address,address,uint256)' }],
            updatedAt: Date.now() - SELECTOR_SUCCESS_DEADLINE_MS - 1
          }
        })
      },
      { overrides: { fetch: failingFetch } }
    )

    // Cache is expired — triggers a fetch that fails
    void contractInfo.getSelector('0x23b872dd')
    await wait(0)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('loading')
    expect((contractInfo.selectors['0x23b872dd'] as any).data).toBeTruthy()
    await wait(3000)
    expect(cenaCalls).toBe(2)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('error')

    // Old data is preserved despite the fetch failure
    expect((contractInfo.selectors['0x23b872dd'] as any).data).toMatchObject([
      { signature: 'transferFrom(address,address,uint256)' }
    ])

    // Error is recent — should not reattempt
    void contractInfo.getSelector('0x23b872dd')
    await wait(3000)
    expect(cenaCalls).toBe(2)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('error')
    expect((contractInfo.selectors['0x23b872dd'] as any).data).toMatchObject([
      { signature: 'transferFrom(address,address,uint256)' }
    ])
  })

  test('Should retry with longer timeout after first attempt fails and succeed on second attempt', async () => {
    let callCount = 0
    const retryFetch = (url: any, ...args: any[]) => {
      if ((url as string).includes(CENA_SELECTORS_URL)) {
        callCount++
        if (callCount === 1) return Promise.reject(new Error('Network error'))
      }
      return fetchSpy(url, ...args)
    }

    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(undefined, { overrides: { fetch: retryFetch } })

    void contractInfo.getSelector('0x23b872dd')
    await wait(3000)
    expect(callCount).toBe(2)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('success')
    expect((contractInfo.selectors['0x23b872dd'] as any).data).toMatchObject(
      (PREDEFINED_SELECTORS['0x23b872dd'] as any).data
    )
  })

  test('Should set status to not-found when API returns no signatures, and not reattempt while cache is fresh', async () => {
    // 0xbeeeeeee is a selector that does not exist in the cena database
    const selector = '0xbeeeeeee'

    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(undefined, { overrides: { fetch: fetchSpy } })

    void contractInfo.getSelector(selector)
    await wait(3000)
    expect(fetchSourcifyCounter).toBe(1)
    expect(contractInfo.selectors[selector]?.status).toBe('not-found')

    // not-found result is cached — should not reattempt
    void contractInfo.getSelector(selector)
    await wait(3000)
    expect(fetchSourcifyCounter).toBe(1)
    expect(contractInfo.selectors[selector]?.status).toBe('not-found')
  })

  test('Should re-fetch a selector whose updatedAt is older than SELECTOR_SUCCESS_DEADLINE_MS', async () => {
    let cenaCalls = 0
    const trackingFetch = (url: any, ...args: any[]) => {
      if ((url as string).includes(CENA_SELECTORS_URL)) cenaCalls++
      return fetchSpy(url, ...args)
    }

    const {
      mainCtrl: { contractInfo }
    } = await makeMainController(
      async (storage) => {
        await storage.set(FUNCTION_SELECTORS_STORAGE_KEY, {
          '0x23b872dd': {
            status: 'success',
            data: [{ signature: 'transferFrom(address,address,uint256)' }],
            updatedAt: Date.now() - SELECTOR_SUCCESS_DEADLINE_MS - 1
          }
        })
      },
      { overrides: { fetch: trackingFetch } }
    )

    void contractInfo.getSelector('0x23b872dd')
    await wait(3000)
    expect(cenaCalls).toBe(1)
    expect(contractInfo.selectors['0x23b872dd']?.status).toBe('success')
    expect(contractInfo.selectors['0x23b872dd']?.updatedAt).toBeGreaterThan(Date.now() - 10000)
  })
})
