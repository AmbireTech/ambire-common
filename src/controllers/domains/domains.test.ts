import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { networks } from '../../consts/networks'
import { getRpcProvider } from '../../services/provider'
import * as withTimeoutModule from '../../utils/with-timeout'
import {
  DomainsController,
  PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS,
  PERSIST_DOMAIN_FOR_IN_MS
} from './domains'

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const ENS = {
  address: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
  name: 'elmoto.eth'
}

const ENS2 = {
  address: '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD',
  name: 'josh.eth'
}

const NO_DOMAINS_ADDRESS = '0x1b9B9813C5805A60184091956F8b36E752272a93'

describe('Domains', () => {
  const domainsController = new DomainsController(providers)

  it('should reverse lookup (ENS)', async () => {
    await domainsController.reverseLookup(ENS.address)

    expect(domainsController.domains[ENS.address].ens).toBe(ENS.name)
  })
  it('should save resolved reverse lookup', () => {
    const { name, address } = ENS2
    const type = 'ens'

    domainsController.saveResolvedReverseLookup({ address, name, type })

    expect(domainsController.domains[address].ens).toBe(name)
  })
  it(`reverse lookup should expire after ${
    PERSIST_DOMAIN_FOR_IN_MS / 1000 / 60
  } min, if the lookup succeeds (the happy case)`, async () => {
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(start)

    const { address, name } = ENS2

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address].ens).toBe(name)

    // 1 min before expiry
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS - 60000)

    const previousUpdatedAt = domainsController.domains[address].updatedAt
    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address].updatedAt).toBe(previousUpdatedAt)

    // 1 min after expiry
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS + 60000)

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address].updatedAt).toBe(
      start + PERSIST_DOMAIN_FOR_IN_MS + 60000
    )

    nowSpy.mockRestore()
  })
  it(`reverse lookup should expire after ${
    PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS / 1000 / 60
  } min, if the last lookup had failed (the unhappy case)`, async () => {
    const { restore } = suppressConsole(true)
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(start)

    const withTimeoutSpy = jest
      .spyOn(withTimeoutModule, 'withTimeout')
      .mockImplementation(async () => {
        throw new Error('forced failure')
      })

    const FAIL_ADDRESS = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'

    // Initial failed lookup sets updateFailedAt
    await domainsController.reverseLookup(FAIL_ADDRESS)
    const firstFailedAt = domainsController.domains[FAIL_ADDRESS].updateFailedAt
    expect(typeof firstFailedAt).toBe('number')

    // 1 min before failure-expiry -> no retry, timestamp unchanged
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS - 60000)
    await domainsController.reverseLookup(FAIL_ADDRESS)
    expect(domainsController.domains[FAIL_ADDRESS].updateFailedAt).toBe(firstFailedAt)

    // 1 min after failure-expiry -> retry, timestamp updated
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS + 60000)
    await domainsController.reverseLookup(FAIL_ADDRESS)
    expect(domainsController.domains[FAIL_ADDRESS].updateFailedAt).toBe(
      start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS + 60000
    )

    withTimeoutSpy.mockRestore()
    nowSpy.mockRestore()
    restore()
  })
  it('should NOT reverse lookup if already resolved', async () => {
    const { address } = ENS2

    const lastUpdatedAt = domainsController.domains[address].updatedAt
    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address].updatedAt).toBe(lastUpdatedAt)

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address].updatedAt).toBe(lastUpdatedAt)
  })
  it('should set ens to null if no domain is found', async () => {
    await domainsController.reverseLookup(NO_DOMAINS_ADDRESS)

    expect(domainsController.domains[NO_DOMAINS_ADDRESS].ens).toBe(null)
  })
  it('should reverse multiple addresses', async () => {
    domainsController.domains = {}

    expect(Object.keys(domainsController.domains).length).toBe(0)

    await domainsController.batchReverseLookup([ENS.address, ENS2.address])

    expect(domainsController.domains[ENS.address].ens).toBe(ENS.name)
    expect(domainsController.domains[ENS2.address].ens).toBe(ENS2.name)
  })
})
