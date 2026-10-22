import { Interface } from 'ethers'

import { Selectors } from '@/interfaces/contractInfo'
import { IUiController } from '@/interfaces/ui'
import { CALLDATA_SELECTOR_HEX_LENGTH } from '@/libs/decodeCall'
import { describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import {
  makeSelectorsApi as makeSelectorsApiWithSignatures,
  waitUntil
} from '../../../test/helpers/contractInfo'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { StorageController } from '../storage/storage'
import {
  ContractInfoController,
  FUNCTION_SELECTORS_STORAGE_KEY,
  SELECTOR_ERROR_DEADLINE_MS,
  SELECTOR_FETCH_DEBOUNCE_MS,
  SELECTOR_SUCCESS_DEADLINE_MS
} from './contractInfo'

const CENA_URL = 'https://cena.test'
const REAL_CENA_URL = 'https://cena.ambire.com'
const SELECTOR_PRIVACY_PREFIX_LENGTH = 6

const RECIPIENT = '0x742d35CC6634C0532925a3b844bc1E4C23a39E18'
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const TRANSFER_SIGNATURE = 'transfer(address,uint256)'
const APPROVE_SIGNATURE = 'approve(address,uint256)'
const EXECUTE_SIGNATURE = 'execute((address,uint256,bytes)[])'
const MINT_SELECTOR = '0x40c10f19'

const transferData = new Interface([`function ${TRANSFER_SIGNATURE}`]).encodeFunctionData(
  'transfer',
  [RECIPIENT, 1000n]
)
const approveData = new Interface([`function ${APPROVE_SIGNATURE}`]).encodeFunctionData('approve', [
  RECIPIENT,
  5n
])
const executeData = new Interface([`function ${EXECUTE_SIGNATURE}`]).encodeFunctionData('execute', [
  [
    [TOKEN, 0n, transferData],
    [TOKEN, 0n, approveData]
  ]
])

const selectorOf = (data: string) => data.slice(0, CALLDATA_SELECTOR_HEX_LENGTH)

const TRANSFER_SELECTOR = selectorOf(transferData)
const APPROVE_SELECTOR = selectorOf(approveData)
const EXECUTE_SELECTOR = selectorOf(executeData)

const API_SIGNATURES: Record<string, string[]> = {
  [TRANSFER_SELECTOR]: [TRANSFER_SIGNATURE],
  [APPROVE_SELECTOR]: [APPROVE_SIGNATURE],
  [EXECUTE_SELECTOR]: [EXECUTE_SIGNATURE]
}

const makeSelectorsApi = (options?: Parameters<typeof makeSelectorsApiWithSignatures>[1]) =>
  makeSelectorsApiWithSignatures(API_SIGNATURES, options)

const makeController = async ({
  fetch,
  savedSelectors,
  isFetchingEnabled = true,
  sendUiMessage = jest.fn(),
  cenaUrl = CENA_URL
}: {
  fetch: any
  savedSelectors?: Record<string, unknown>
  isFetchingEnabled?: boolean
  sendUiMessage?: jest.Mock
  cenaUrl?: string
}) => {
  const storage = new StorageController(produceMemoryStore())
  if (savedSelectors) await storage.set(FUNCTION_SELECTORS_STORAGE_KEY, savedSelectors as Selectors)

  const featureFlags = new FeatureFlagsController(
    { apiForFunctionSelectors: isFetchingEnabled },
    storage
  )
  await featureFlags.initialLoadPromise

  const ui = { message: { sendUiMessage } } as unknown as IUiController
  const contractInfo = new ContractInfoController({ fetch, storage, featureFlags, ui, cenaUrl })
  await contractInfo.initialLoadPromise

  return { contractInfo, storage, featureFlags, sendUiMessage }
}

const successEntry = (signature: string, updatedAt = Date.now()) => ({
  status: 'success',
  data: [{ signature }],
  updatedAt
})

describe('ContractInfoController', () => {
  test('never emits updates, and keeps the selectors out of its serialized state', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({
      fetch: api.fetch,
      savedSelectors: { [TRANSFER_SELECTOR]: successEntry(TRANSFER_SIGNATURE) }
    })
    const onUpdate = jest.fn()
    contractInfo.onUpdate(onUpdate)

    contractInfo.decodeCallData(executeData)
    await contractInfo.fetchSelectors([EXECUTE_SELECTOR, APPROVE_SELECTOR])

    const serializedState = JSON.stringify(contractInfo)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(serializedState).not.toContain(TRANSFER_SELECTOR)
    expect(serializedState).not.toContain(EXECUTE_SELECTOR)
  })

  test('decodes from saved selectors without fetching anything', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({
      fetch: api.fetch,
      savedSelectors: {
        [EXECUTE_SELECTOR]: successEntry(EXECUTE_SIGNATURE),
        [TRANSFER_SELECTOR]: successEntry(TRANSFER_SIGNATURE),
        [APPROVE_SELECTOR]: successEntry(APPROVE_SIGNATURE)
      }
    })

    const decodedCall = contractInfo.decodeCallData(executeData)
    await contractInfo.fetchSelectorsForCallDatas([executeData])

    expect(decodedCall?.signature).toBe(EXECUTE_SIGNATURE)
    expect((decodedCall?.args[0]?.val as any)[0].val[2].val.signature).toBe(TRANSFER_SIGNATURE)
    expect(api.fetch).not.toHaveBeenCalled()
  })

  test('fetches the never fetched and expired selectors of the call datas, but not fresh ones', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({
      fetch: api.fetch,
      savedSelectors: {
        // expired, but its old signature is still used to decode
        [EXECUTE_SELECTOR]: successEntry(
          EXECUTE_SIGNATURE,
          Date.now() - SELECTOR_SUCCESS_DEADLINE_MS - 1
        ),
        [TRANSFER_SELECTOR]: { status: 'not-found', updatedAt: Date.now() }
      }
    })

    // The expired signature is still used to decode, so the nested selectors are known up front
    expect(contractInfo.decodeCallData(executeData)?.signature).toBe(EXECUTE_SIGNATURE)

    await contractInfo.fetchSelectorsForCallDatas([executeData])

    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]!.prefixes.sort()).toEqual(
      [
        APPROVE_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH),
        EXECUTE_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH)
      ].sort()
    )
  })

  test('fetches the selectors of the call datas in rounds until the nested calls decode too', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({ fetch: api.fetch })

    expect(contractInfo.decodeCallData(executeData)).toBeNull()

    await contractInfo.fetchSelectorsForCallDatas([executeData])

    expect(api.requests).toHaveLength(2)
    expect(api.requests[0]!.prefixes).toEqual([
      EXECUTE_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH)
    ])
    expect(api.requests[1]!.prefixes.sort()).toEqual(
      [
        TRANSFER_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH),
        APPROVE_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH)
      ].sort()
    )
    const decodedCall = contractInfo.decodeCallData(executeData)
    expect(decodedCall?.signature).toBe(EXECUTE_SIGNATURE)
    const [transferCall, approveCall] = decodedCall?.args[0]?.val as any[]
    expect(transferCall.val[2].val.signature).toBe(TRANSFER_SIGNATURE)
    expect(approveCall.val[2].val.signature).toBe(APPROVE_SIGNATURE)
  })

  test('shares the requests of concurrent call data fetches that need the same selectors', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({ fetch: api.fetch })

    await Promise.all([
      contractInfo.fetchSelectorsForCallDatas([executeData]),
      contractInfo.fetchSelectorsForCallDatas([transferData, executeData])
    ])

    expect(api.requests).toHaveLength(2)
    expect(api.requests.flatMap(({ prefixes }) => prefixes).sort()).toEqual(
      [EXECUTE_SELECTOR, TRANSFER_SELECTOR, APPROVE_SELECTOR]
        .map((selector) => selector.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH))
        .sort()
    )
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
    expect(contractInfo.decodeCallData(executeData)?.signature).toBe(EXECUTE_SIGNATURE)
  })

  test('stops fetching the selectors of the call datas when the API has no signature for them', async () => {
    const api = makeSelectorsApiWithSignatures({})
    const { contractInfo, storage } = await makeController({ fetch: api.fetch })

    await contractInfo.fetchSelectorsForCallDatas([executeData])

    const storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    expect(api.requests).toHaveLength(1)
    expect(storedSelectors[EXECUTE_SELECTOR]?.status).toBe('not-found')
    expect(contractInfo.decodeCallData(executeData)).toBeNull()
  })

  test('resolves the call data fetch when the API keeps failing, saving the selectors as errors without fetching in a loop', async () => {
    const api = makeSelectorsApi({ failingAttempts: Infinity })
    const { contractInfo, storage } = await makeController({ fetch: api.fetch })

    await expect(contractInfo.fetchSelectorsForCallDatas([executeData])).resolves.toBeUndefined()
    await contractInfo.fetchSelectorsForCallDatas([executeData])

    const storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    // The first try and its retry, and nothing more while the error is fresh
    expect(api.requests).toHaveLength(2)
    expect(storedSelectors[EXECUTE_SELECTOR]?.status).toBe('error')
    expect(contractInfo.decodeCallData(executeData)).toBeNull()
  })

  test('sends selectors asked for close together in one request', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({ fetch: api.fetch })

    const firstFetch = contractInfo.fetchSelectors([TRANSFER_SELECTOR])
    const secondFetch = contractInfo.fetchSelectors([APPROVE_SELECTOR, TRANSFER_SELECTOR])
    await Promise.all([firstFetch, secondFetch])

    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]!.prefixes.sort()).toEqual(
      [
        TRANSFER_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH),
        APPROVE_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH)
      ].sort()
    )
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
    expect(contractInfo.decodeCallData(approveData)?.signature).toBe(APPROVE_SIGNATURE)
  })

  test('waits on the running request for a selector that is already being fetched', async () => {
    const api = makeSelectorsApi({ holdResponses: true })
    const { contractInfo } = await makeController({ fetch: api.fetch })

    let isFirstFetchDone = false
    let isSecondFetchDone = false
    const firstFetch = contractInfo.fetchSelectors([TRANSFER_SELECTOR]).then(() => {
      isFirstFetchDone = true
    })
    await waitUntil(() => api.heldResponses.length === 1, 'the first request is in flight')

    const secondFetch = contractInfo.fetchSelectors([TRANSFER_SELECTOR]).then(() => {
      isSecondFetchDone = true
    })
    await new Promise((resolve) => {
      setTimeout(resolve, SELECTOR_FETCH_DEBOUNCE_MS * 2)
    })
    expect(api.requests).toHaveLength(1)
    expect(isFirstFetchDone).toBe(false)
    expect(isSecondFetchDone).toBe(false)

    api.heldResponses[0]!.resolve()
    await Promise.all([firstFetch, secondFetch])
    expect(api.requests).toHaveLength(1)
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
  })

  test('fetches a selector asked for during a running request in the next request, without waiting for the first', async () => {
    const api = makeSelectorsApi({ holdResponses: true })
    const { contractInfo } = await makeController({ fetch: api.fetch })

    let isTransferFetchDone = false
    const transferFetch = contractInfo.fetchSelectors([TRANSFER_SELECTOR]).then(() => {
      isTransferFetchDone = true
    })
    await waitUntil(() => api.heldResponses.length === 1, 'the first request is in flight')

    const approveFetch = contractInfo.fetchSelectors([APPROVE_SELECTOR])
    await waitUntil(() => api.heldResponses.length === 2, 'the second request is in flight')
    expect(api.requests[1]!.prefixes).toEqual([
      APPROVE_SELECTOR.slice(0, SELECTOR_PRIVACY_PREFIX_LENGTH)
    ])

    api.heldResponses[1]!.resolve()
    await approveFetch
    expect(isTransferFetchDone).toBe(false)
    expect(contractInfo.decodeCallData(approveData)?.signature).toBe(APPROVE_SIGNATURE)
    expect(contractInfo.decodeCallData(transferData)).toBeNull()

    api.heldResponses[0]!.resolve()
    await transferFetch
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
  })

  test('does not fetch a selector again while its saved result is fresh', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({
      fetch: api.fetch,
      savedSelectors: {
        [TRANSFER_SELECTOR]: successEntry(TRANSFER_SIGNATURE),
        [APPROVE_SELECTOR]: { status: 'not-found', updatedAt: Date.now() },
        [EXECUTE_SELECTOR]: { status: 'error', error: 'Network error', updatedAt: Date.now() }
      }
    })

    await contractInfo.fetchSelectors([TRANSFER_SELECTOR, APPROVE_SELECTOR, EXECUTE_SELECTOR])

    expect(api.fetch).not.toHaveBeenCalled()
  })

  test('fetches again once the saved error or success has expired', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({
      fetch: api.fetch,
      savedSelectors: {
        [TRANSFER_SELECTOR]: successEntry(
          TRANSFER_SIGNATURE,
          Date.now() - SELECTOR_SUCCESS_DEADLINE_MS - 1
        ),
        [APPROVE_SELECTOR]: {
          status: 'error',
          error: 'Network error',
          updatedAt: Date.now() - SELECTOR_ERROR_DEADLINE_MS - 1
        }
      }
    })

    await contractInfo.fetchSelectors([TRANSFER_SELECTOR, APPROVE_SELECTOR])

    expect(api.requests).toHaveLength(1)
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
    expect(contractInfo.decodeCallData(approveData)?.signature).toBe(APPROVE_SIGNATURE)

    await contractInfo.fetchSelectorsForCallDatas([transferData, approveData])
    expect(api.requests).toHaveLength(1)
  })

  test('saves a selector the API has no signature for as not found, and does not ask again', async () => {
    const api = makeSelectorsApi()
    const unknownSelector = '0xbeeeeeee'
    const { contractInfo, storage } = await makeController({ fetch: api.fetch })

    await contractInfo.fetchSelectors([unknownSelector])
    await contractInfo.fetchSelectors([unknownSelector])

    const storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    expect(storedSelectors[unknownSelector]?.status).toBe('not-found')
    expect(api.requests).toHaveLength(1)
    await contractInfo.fetchSelectorsForCallDatas([`${unknownSelector}00`])
    expect(api.requests).toHaveLength(1)
  })

  test('retries once after a failed request and succeeds', async () => {
    const api = makeSelectorsApi({ failingAttempts: 1 })
    const { contractInfo } = await makeController({ fetch: api.fetch })

    await contractInfo.fetchSelectors([TRANSFER_SELECTOR])

    expect(api.requests).toHaveLength(2)
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
  })

  test('saves a failed fetch as an error that keeps the old signatures, resolves instead of rejecting, and does not ask again while the error is fresh', async () => {
    const api = makeSelectorsApi({ failingAttempts: Infinity })
    const { contractInfo, storage } = await makeController({
      fetch: api.fetch,
      savedSelectors: {
        [TRANSFER_SELECTOR]: successEntry(
          TRANSFER_SIGNATURE,
          Date.now() - SELECTOR_SUCCESS_DEADLINE_MS - 1
        )
      }
    })
    const onError = jest.fn()
    contractInfo.onError(onError)

    await expect(contractInfo.fetchSelectors([TRANSFER_SELECTOR])).resolves.toBeUndefined()

    const storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    expect(api.requests).toHaveLength(2)
    expect(onError).toHaveBeenCalled()
    expect(storedSelectors[TRANSFER_SELECTOR]).toMatchObject({
      status: 'error',
      data: [{ signature: TRANSFER_SIGNATURE }]
    })
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)

    await contractInfo.fetchSelectors([TRANSFER_SELECTOR])
    await contractInfo.fetchSelectorsForCallDatas([transferData])
    expect(api.requests).toHaveLength(2)
  })

  test('with fetching disabled, fetches nothing and still decodes saved selectors', async () => {
    const api = makeSelectorsApi()
    const { contractInfo } = await makeController({
      fetch: api.fetch,
      isFetchingEnabled: false,
      savedSelectors: { [TRANSFER_SELECTOR]: successEntry(TRANSFER_SIGNATURE) }
    })

    expect(contractInfo.decodeCallData(executeData)).toBeNull()
    await contractInfo.fetchSelectors([EXECUTE_SELECTOR])
    await contractInfo.fetchSelectorsForCallDatas([executeData])

    expect(api.fetch).not.toHaveBeenCalled()
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
  })

  test('fetches again once fetching is enabled again', async () => {
    const api = makeSelectorsApi()
    const { contractInfo, featureFlags } = await makeController({
      fetch: api.fetch,
      isFetchingEnabled: false
    })

    await contractInfo.fetchSelectors([TRANSFER_SELECTOR])
    expect(api.fetch).not.toHaveBeenCalled()

    await featureFlags.setFeatureFlag('apiForFunctionSelectors', true)
    await contractInfo.fetchSelectorsForCallDatas([transferData])

    expect(api.requests).toHaveLength(1)
    expect(contractInfo.decodeCallData(transferData)?.signature).toBe(TRANSFER_SIGNATURE)
  })

  test('replies to the UI with the decoded calls in order, null for the ones it cannot decode, without fetching', async () => {
    const api = makeSelectorsApi()
    const { contractInfo, sendUiMessage } = await makeController({
      fetch: api.fetch,
      savedSelectors: { [TRANSFER_SELECTOR]: successEntry(TRANSFER_SIGNATURE) }
    })

    await contractInfo.decodeCallsForUi([approveData, transferData, '0x'], 'request-1')

    expect(sendUiMessage).toHaveBeenCalledTimes(1)
    const [message] = sendUiMessage.mock.calls[0] as [any]
    expect(message.requestId).toBe('request-1')
    expect(message.ok).toBe(true)
    expect(message.res).toHaveLength(3)
    expect(message.res[0]).toBeNull()
    expect(message.res[1].signature).toBe(TRANSFER_SIGNATURE)
    expect(message.res[2]).toBeNull()
    expect(api.fetch).not.toHaveBeenCalled()
  })

  test('fetches real selectors from the API and saves them to storage', async () => {
    const { contractInfo, storage } = await makeController({
      fetch: global.fetch,
      cenaUrl: REAL_CENA_URL
    })

    await contractInfo.fetchSelectors([MINT_SELECTOR])

    const storedSelectors = await storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    expect(storedSelectors[MINT_SELECTOR]?.status).toBe('success')
    expect((storedSelectors[MINT_SELECTOR] as any).data).toEqual(
      expect.arrayContaining([{ signature: 'mint(address,uint256)' }])
    )
  })
})
