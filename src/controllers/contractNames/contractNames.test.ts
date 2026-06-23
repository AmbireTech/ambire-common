import { Wallet, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { ContractNamesController, PERSIST_NOT_FOUND_IN_MS } from './contractNames'

const contracts = {
  uniV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  ambireAtETHSofia: '0x3Bd57Bf93dE179d2e47e86319F144d7482503C7d'
}

const DEFAULT_DEBOUNCE = 100

const waitForNthUpdate = (ctrl: ContractNamesController, n: number) =>
  new Promise((resolve) => {
    let count = 0
    const unsub = ctrl.onUpdate(() => {
      if (++count === n) {
        unsub()
        resolve(true)
      }
    })
  })

describe('Contract Names', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllTimers()
  })

  it('Successfully find multiple and ignore random', async () => {
    // init
    const mockedFetch = jest.fn(fetch)
    const contractNamesController = new ContractNamesController({ fetch: mockedFetch })
    const randomAddress = Wallet.createRandom().address

    // request multiple
    contractNamesController.getName(contracts.uniV3Factory, 1n)
    contractNamesController.getName(contracts.ambireAtETHSofia, 10n)
    contractNamesController.getName(contracts.ambireAtETHSofia, 10n)
    contractNamesController.getName(contracts.ambireAtETHSofia, 10n)
    contractNamesController.getName(ZeroAddress, 137n)
    contractNamesController.getName(ZeroAddress, 137n)
    contractNamesController.getName(ZeroAddress, 137n)
    contractNamesController.getName(randomAddress, 8453n)

    // asses ok state
    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(4)
    expect(mockedFetch).toHaveBeenCalledTimes(0)

    jest.advanceTimersByTime(DEFAULT_DEBOUNCE)

    // make sure the function has been executed
    await waitForNthUpdate(contractNamesController, 2)

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(0)
    expect(contractNamesController.contractNames[randomAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress]!.name).toBeFalsy()
    expect(contractNamesController.contractNames[ZeroAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[ZeroAddress]!.name).toBeFalsy()
    expect(contractNamesController.contractNames[contracts.ambireAtETHSofia]!.name).toBe(
      'EthSofiaNft'
    )
    expect(contractNamesController.contractNames[contracts.uniV3Factory]!.name).toBe(
      'UniswapV3Factory'
    )
  })

  it('Refetch failed addresses', async () => {
    const { restore } = suppressConsole()
    // init
    const mockedFetch = jest.fn(fetch)
    const contractNamesController = new ContractNamesController({ fetch: mockedFetch })
    const randomAddress = Wallet.createRandom().address

    // request a non contract address that will fail
    contractNamesController.getName(randomAddress, 8453n)

    jest.advanceTimersByTime(DEFAULT_DEBOUNCE)

    // make sure the function has been executed
    await waitForNthUpdate(contractNamesController, 2)

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractNames[randomAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress]!.name).toBeFalsy()
    // time for failed records and errors to be considered stale
    // after that we will refetch the data for those addresses if requested
    jest.advanceTimersByTime(PERSIST_NOT_FOUND_IN_MS)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    // make a second attempt after PERSIST_NOT_FOUND_IN_MS time
    contractNamesController.getName(randomAddress, 8453n)
    jest.advanceTimersByTime(DEFAULT_DEBOUNCE)
    // make sure the function has been executed
    await waitForNthUpdate(contractNamesController, 2)

    // make sure an attempt was actually made
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    restore()
  })

  it('fetch two times', async () => {
    // init
    const mockedFetch = jest.fn(fetch)
    const contractNamesController = new ContractNamesController({ fetch: mockedFetch })
    const randomAddress1 = Wallet.createRandom().address
    const randomAddress2 = Wallet.createRandom().address

    // request a non contract address that will fail
    contractNamesController.getName(randomAddress1, 8453n)

    jest.advanceTimersByTime(DEFAULT_DEBOUNCE)

    // make sure the function has been executed
    await waitForNthUpdate(contractNamesController, 2)

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractNames[randomAddress1]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress1]!.name).toBeFalsy()
    expect(contractNamesController.contractNames[randomAddress1]!.retryAfter).toBe(
      PERSIST_NOT_FOUND_IN_MS
    )

    // request second address
    contractNamesController.getName(randomAddress2, 8453n)
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(DEFAULT_DEBOUNCE)

    // make sure the function has been executed
    await waitForNthUpdate(contractNamesController, 2)

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(contractNamesController.contractNames[randomAddress2]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress2]!.name).toBeFalsy()
    expect(contractNamesController.contractNames[randomAddress2]!.retryAfter).toBe(
      PERSIST_NOT_FOUND_IN_MS
    )
  })

  it('Test address validity handling', async () => {
    // This test uses real timers since it only checks synchronous validation errors
    jest.useRealTimers()
    const { restore } = suppressConsole()
    const badCheckSum = '0x026224a2940bfe258D0dbE947919B62fE321F042'
    const randomAddress = Wallet.createRandom().address
    const contractNamesController = new ContractNamesController({ fetch })
    const errorPromise = new Promise((resolve) => {
      // expected error for wrong address format
      contractNamesController.onError(resolve)
    })
    contractNamesController.getName(badCheckSum, 1n)
    await errorPromise

    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(0)

    contractNamesController.getName(randomAddress, 1n)
    contractNamesController.getName(randomAddress.toLowerCase(), 1n)

    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(1)
    restore()
  })
})
