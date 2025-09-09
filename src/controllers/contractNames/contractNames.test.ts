import { Wallet, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { expect, jest } from '@jest/globals'

import { ContractNamesController, PERSIST_FAILED_IN_MS } from './contractNames'

const contracts = {
  uniV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  ambireAtETHSofia: '0x3Bd57Bf93dE179d2e47e86319F144d7482503C7d'
}
let finishPromise

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
    expect(contractNamesController.loadingAddresses.length).toBe(4)
    expect(mockedFetch).toHaveBeenCalledTimes(0)

    // The default time for debounce is 50ms
    jest.advanceTimersByTime(50)

    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      contractNamesController.onUpdate(resolve)
    })
    await finishPromise

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.loadingAddresses.length).toBe(0)
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

    // The default time for debounce is 50ms
    jest.advanceTimersByTime(50)

    // make sure the function has been executed
    finishPromise = new Promise((resolve) => {
      contractNamesController.onUpdate(resolve)
    })
    await finishPromise

    // asses ok result
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(contractNamesController.contractNames[randomAddress]).toBeTruthy()
    expect(contractNamesController.contractNames[randomAddress].name).toBeFalsy()

    // time for failed records and errors to be considered stale
    // after that we will refetch the data for those addresses if requested
    jest.advanceTimersByTime(PERSIST_FAILED_IN_MS)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    // make a second attempt after PERSIST_FAILED_IN_MS time
    contractNamesController.getName(randomAddress, 8453n)
    jest.advanceTimersByTime(50)
    finishPromise = new Promise((resolve) => {
      contractNamesController.onUpdate(resolve)
    })
    await finishPromise

    // make sure an attempt was actually made
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })
})
