import { JsonRpcProvider } from 'ethers'
// @ts-ignore
import fetch from 'node-fetch'

import { jest } from '@jest/globals'

import { networks } from '../../consts/networks'
import { DomainsController } from './domains'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

const ENS = {
  address: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
  name: 'elmoto.eth'
}

const ENS2 = {
  address: '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD',
  name: 'josh.eth'
}

const UD = {
  address: '0x8aaD44321A86b170879d7A244c1e8d360c99DdA8',
  name: 'brad.x'
}

describe('Domains', () => {
  const domainsController = new DomainsController(providers, fetch)

  it('should reverse lookup (ENS)', async () => {
    await domainsController.reverseLookup(ENS.address)

    expect(domainsController.domains[ENS.address].ens).toBe(ENS.name)
  })
  it('should reverse lookup (UD)', async () => {
    await domainsController.reverseLookup(UD.address)

    expect(domainsController.domains[UD.address].ud).toBe(UD.name)
  })
  it('should save resolved reverse lookup', () => {
    const { name, address } = ENS2
    const type = 'ens'

    domainsController.saveResolvedReverseLookup({ address, name, type })

    expect(domainsController.domains[address].ens).toBe(name)
  })
  it('reverse lookup should expire after 24 hours', async () => {
    const { address, name } = ENS2

    await domainsController.reverseLookup(address)

    expect(domainsController.domains[address].ens).toBe(name)

    const timestampForwardInTime = new Date(Date.UTC(2028, 1, 1)).valueOf()

    Date.now = jest.fn(() => timestampForwardInTime)

    await domainsController.reverseLookup(address)

    expect(domainsController.domains[address].savedAt).toBe(timestampForwardInTime)
  })
})
