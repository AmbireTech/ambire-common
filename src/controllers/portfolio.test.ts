import { describe, expect } from '@jest/globals'
import { PortfolioController, produceMemoryStore } from './portfolio'
import { networks } from '../consts/networks'

describe('Portfolio Controller ', () => {
  const account = {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    label: '',
    pfp: '',
    associatedKeys: [],
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  }

  test('Previous tokens are persisted in the storage', async () => {
    const storage = produceMemoryStore()
    const controller = new PortfolioController(storage)

    await controller.updateSelectedAccount([account], networks, account.addr, [])
    const storagePreviousHints = await storage.get('previousHints', {})

    expect(storagePreviousHints[`ethereum:${account.addr}`]).toEqual({
      erc20s: [
        '0x0000000000000000000000000000000000000000',
        '0xba100000625a3754423978a60c9317c58a424e3D',
        '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      ],
      erc721s: {}
    })
  })
})
