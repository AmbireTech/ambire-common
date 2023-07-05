import { describe, expect, test } from '@jest/globals'
import { MainController } from './main'
import { Storage } from '../../interfaces/storage'

export function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, JSON.stringify(value))
      return Promise.resolve(null)
    }
  }
}

describe('Main Controller ', () => {
  const accounts = [
    {
      addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
      label: '',
      pfp: '',
      associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    },
    {
      addr: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
      label: '',
      pfp: '',
      associatedKeys: ['0xfF3f6D14DF43c112aB98834Ee1F82083E07c26BF'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f1e7646e4695bead8bb0596679b0caf3a7ff6c4e04d2ad79103c8fa61fb6337f47fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    },
    {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      label: '',
      pfp: '',
      associatedKeys: [],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
      }
    }
  ]

  const storage = produceMemoryStore()
  storage.set('accounts', accounts)
  test('Init controller', async () => {
    const controller = new MainController(storage)
    controller.onUpdate((res) => {
        console.log()
    })
    setInterval(() => {
      const states = controller.currentAccountStates
      console.log(states, controller.lastUpdate)
      controller.pushUpdate()
    }, 1000)
    // expect(states).to
  })
})
