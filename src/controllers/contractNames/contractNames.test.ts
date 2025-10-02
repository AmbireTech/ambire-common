import { Wallet, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { expect, jest } from '@jest/globals'

import { ContractNamesController, PERSIST_NOT_FOUND_IN_MS } from './contractNames'

const contracts = {
  uniV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  ambireAtETHSofia: '0x3Bd57Bf93dE179d2e47e86319F144d7482503C7d'
}
let finishPromise
let errorPromise

describe('Contract Names', () => {
  it('Successfully find multiple and ignore random', async () => {
    // init
    jest.useFakeTimers()
    const mockedFetch = jest.fn(fetch)
    const contractNamesController = new ContractNamesController(mockedFetch)
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

    // The default time for debounce is 100ms
    jest.advanceTimersByTime(100)

    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      let emitCounter = 0
      contractNamesController.onUpdate(() => {
        emitCounter++
        if (emitCounter === 2) resolve(true)
      })
    })
    await finishPromise

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(0)
    expect(contractNamesController.contractNames[randomAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress].name).toBeFalsy()
    expect(contractNamesController.contractNames[ZeroAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[ZeroAddress].name).toBeFalsy()
    expect(contractNamesController.contractNames[contracts.ambireAtETHSofia].name).toBe(
      'EthSofiaNft'
    )
    expect(contractNamesController.contractNames[contracts.uniV3Factory].name).toBe(
      'UniswapV3Factory'
    )
    jest.useRealTimers()
  })

  it('Refetch failed addresses', async () => {
    // init
    jest.useFakeTimers()
    const mockedFetch = jest.fn(fetch)
    const contractNamesController = new ContractNamesController(mockedFetch)
    const randomAddress = Wallet.createRandom().address

    // request a non contract address that will fail
    contractNamesController.getName(randomAddress, 8453n)

    // The default time for debounce is 100ms
    jest.advanceTimersByTime(100)

    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      let emitCounter = 0
      contractNamesController.onUpdate(() => {
        emitCounter++
        if (emitCounter === 2) resolve(true)
      })
    })
    await finishPromise

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractNames[randomAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress].name).toBeFalsy()
    // time for failed records and errors to be considered stale
    // after that we will refetch the data for those addresses if requested
    jest.advanceTimersByTime(PERSIST_NOT_FOUND_IN_MS)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    // make a second attempt after PERSIST_NOT_FOUND_IN_MS time
    contractNamesController.getName(randomAddress, 8453n)
    jest.advanceTimersByTime(100)
    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      let emitCounter = 0
      contractNamesController.onUpdate(() => {
        emitCounter++
        if (emitCounter === 2) resolve(true)
      })
    })
    await finishPromise

    // make sure an attempt was actually made
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })
  it('fetch two times', async () => {
    // init
    jest.useFakeTimers()
    const mockedFetch = jest.fn(fetch)
    const contractNamesController = new ContractNamesController(mockedFetch)
    const randomAddress1 = Wallet.createRandom().address
    const randomAddress2 = Wallet.createRandom().address

    // request a non contract address that will fail
    contractNamesController.getName(randomAddress1, 8453n)

    // The default time for debounce is 100ms
    jest.advanceTimersByTime(100)

    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      let emitCounter = 0
      contractNamesController.onUpdate(() => {
        emitCounter++
        if (emitCounter === 2) resolve(true)
      })
    })
    await finishPromise

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractNames[randomAddress1]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress1].name).toBeFalsy()
    expect(contractNamesController.contractNames[randomAddress1].retryAfter).toBe(
      PERSIST_NOT_FOUND_IN_MS
    )

    // request second address
    contractNamesController.getName(randomAddress2, 8453n)
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(100)

    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      let emitCounter = 0
      contractNamesController.onUpdate(() => {
        emitCounter++
        if (emitCounter === 2) resolve(true)
      })
    })
    await finishPromise

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(contractNamesController.contractNames[randomAddress2]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress2].name).toBeFalsy()
    expect(contractNamesController.contractNames[randomAddress2].retryAfter).toBe(
      PERSIST_NOT_FOUND_IN_MS
    )
    jest.useRealTimers()
  })

  it('Test address validity handling', async () => {
    const badCheckSum = '0x026224a2940bfe258D0dbE947919B62fE321F042'
    const randomAddress = Wallet.createRandom().address
    const contractNamesController = new ContractNamesController(fetch)
    errorPromise = new Promise((resolve) => {
      // expected error for wrong address format
      contractNamesController.onError(resolve)
    })
    contractNamesController.getName(badCheckSum, 1n)
    await errorPromise

    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(0)

    contractNamesController.getName(randomAddress, 1n)
    contractNamesController.getName(randomAddress.toLowerCase(), 1n)

    expect(contractNamesController.contractsPendingToBeFetched.length).toBe(1)
  })
})
