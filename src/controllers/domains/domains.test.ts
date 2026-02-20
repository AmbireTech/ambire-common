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

// 0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41
const ENS_OLDEST_RESOLVER = {
  address: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
  name: 'elmoto.eth'
}

// 0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63
const ENS_OLD_RESOLVER = {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  name: 'vitalik.eth'
}

// 0xF29100983E058B709F3D539b0c765937B804AC15
const ENS_LATEST_RESOLVER = {
  address: '0x03077e67a87a92471ef93339e153DfD255E59977',
  name: 'karawanken.eth'
}

const ENS2 = {
  address: '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD',
  name: 'josh.eth'
}

const WNS_FORWARD = {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  name: 'vitalik.wei'
}

const WNS_REVERSE = {
  address: '0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20',
  name: 'ross.wei'
}

const NO_DOMAINS_ADDRESS = '0x1b9B9813C5805A60184091956F8b36E752272a93'

describe('Domains', () => {
  const domainsController = new DomainsController({ providers })

  it('should reverse lookup (ENS)', async () => {
    await domainsController.reverseLookup(ENS_OLDEST_RESOLVER.address)

    expect(domainsController.domains[ENS_OLDEST_RESOLVER.address]!.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
  })
  it('should reverse lookup ENS with the latest resolver', async () => {
    await domainsController.reverseLookup(ENS_LATEST_RESOLVER.address)

    expect(domainsController.domains[ENS_LATEST_RESOLVER.address]!.ens).toBe(
      ENS_LATEST_RESOLVER.name
    )
  })
  it('should resolve domain', async () => {
    const { name, address } = ENS2

    await domainsController.resolveDomain({ domain: name })

    expect(domainsController.ensToAddress[name]).toBe(address)
  })
  it('should resolve a .wei domain (WNS)', async () => {
    const { name, address } = WNS_FORWARD

    await domainsController.resolveDomain({ domain: name })

    expect(domainsController.wnsToAddress[name]).toBe(address)
  })
  it('should reverse lookup (WNS)', async () => {
    await domainsController.reverseLookup(WNS_REVERSE.address)

    expect(domainsController.domains[WNS_REVERSE.address]!.wns).toBe(WNS_REVERSE.name)
  })
  it(`reverse lookup should expire after ${
    PERSIST_DOMAIN_FOR_IN_MS / 1000 / 60
  } min, if the lookup succeeds (the happy case)`, async () => {
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(start)

    const { address, name } = ENS2

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.ens).toBe(name)

    // 1 min before expiry
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS - 60000)

    const previousUpdatedAt = domainsController.domains[address]!.updatedAt
    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(previousUpdatedAt)

    // 1 min after expiry
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS + 60000)

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(
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
    const firstFailedAt = domainsController.domains[FAIL_ADDRESS]!.updateFailedAt
    expect(typeof firstFailedAt).toBe('number')

    // 1 min before failure-expiry -> no retry, timestamp unchanged
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS - 60000)
    await domainsController.reverseLookup(FAIL_ADDRESS)
    expect(domainsController.domains[FAIL_ADDRESS]!.updateFailedAt).toBe(firstFailedAt)

    // 1 min after failure-expiry -> retry, timestamp updated
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS + 60000)
    await domainsController.reverseLookup(FAIL_ADDRESS)
    expect(domainsController.domains[FAIL_ADDRESS]!.updateFailedAt).toBe(
      start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS + 60000
    )

    withTimeoutSpy.mockRestore()
    nowSpy.mockRestore()
    restore()
  })
  it('should NOT reverse lookup if already resolved', async () => {
    const { address } = ENS2

    const lastUpdatedAt = domainsController.domains[address]!.updatedAt
    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(lastUpdatedAt)

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(lastUpdatedAt)
  })
  it('should set ens to null if no domain is found', async () => {
    await domainsController.reverseLookup(NO_DOMAINS_ADDRESS)

    expect(domainsController.domains[NO_DOMAINS_ADDRESS]!.ens).toBe(null)
  })
  it('should reverse multiple addresses and work with all resolvers', async () => {
    domainsController.domains = {}

    expect(Object.keys(domainsController.domains).length).toBe(0)

    await domainsController.batchReverseLookup([
      ENS_OLDEST_RESOLVER.address,
      ENS_OLD_RESOLVER.address,
      ENS_LATEST_RESOLVER.address
    ])

    expect(domainsController.domains[ENS_OLDEST_RESOLVER.address]!.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
    expect(domainsController.domains[ENS_OLD_RESOLVER.address]!.ens).toBe(ENS_OLD_RESOLVER.name)
    expect(domainsController.domains[ENS_LATEST_RESOLVER.address]!.ens).toBe(
      ENS_LATEST_RESOLVER.name
    )
  })
})
