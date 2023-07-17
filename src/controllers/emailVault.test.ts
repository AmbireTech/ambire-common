import { describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { MainController } from './main/main'
import { Storage } from '../interfaces/storage'
import { ethers } from 'ethers'
import { networks } from '../consts/networks'
import { Account } from 'interfaces/account'
import { EmailVault } from '../libs/emailVault/emailVault'

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
  const relayerUrl = 'https://staging-relayer.ambire.com'
  const email = 'emil@ambire.com'
  storage.set('accounts', accounts)
  let controller: MainController

  test('Init controller', async () => {
    controller = new MainController(storage, fetch, relayerUrl)
    await new Promise((resolve) => controller.onUpdate(() => resolve(null)))
  })

  test('login wit emailVault', async () => {
    controller.emailVault.login(email)
    await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
  })

  test('should succcessfully schedule a recovery and confirm the new key address is added to associatedKeys', async () => {
    const randomAddr = ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
    controller.emailVault.scheduleRecovery(email, accounts[0].addr, randomAddr)
    await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))

    const storageAccounts = await storage.get('accounts', [])
    const account = storageAccounts.filter((acc: Account) => acc.addr == accounts[0].addr)[0]
    expect(account.recoveryTxns.length).not.toBe(0)
  })

  // NOTE<Bobby>: Pls do not delete
  // useful when wanting to test schedule recovery quickly on localhost
  // test('should succcessfully schedule a recovery and confirm the new key address is added to associatedKeys', async () => {
  //   const hardhat = networks.find((x) => x.id === 'hardhat')
  //   if (!hardhat) throw new Error('unable to find hardhat network in consts')
  //   const privAddr = '0x14469F2e8D23044a3aB2b69702eb57B688ff13A5'

  //   const emailVault = new EmailVault(fetch, 'http://localhost:1934')
  //   const signedTxns = await emailVault.scheduleRecovery('6wtp12slyi@uv6tg.aso', 'alabala', '0x2151E1f1fe11Db2042FA32523A72C733Fd9C3DED', hardhat, privAddr)
  //   console.log(signedTxns)
  // })

  // test('send', async () => {
  //   const provider = new ethers.JsonRpcProvider('http://localhost:8545/')
  //   const wallet = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider)
  //   const txn = {
  //     to: '0x2151E1f1fe11Db2042FA32523A72C733Fd9C3DED',
  //     value: 0,
  //     data: '0x6171d1c900000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000002151e1f1fe11db2042fa32523a72c733fd9c3ded0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000440d5828d400000000000000000000000014469f2e8d23044a3ab2b69702eb57b688ff13a50000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000161000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000ab056f50729358dfde5b43f7efdf8819a83d86300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000003f48000000000000000000000000000000000000000000000000000000000000000010000000000000000000000001893b961d2999388693e001a5dc0bb825551b90700000000000000000000000000000000000000000000000000000000000000422d99b82dcc3a5071861c33eea52bd75f72aea9f661dcf85427fd4290c492741c2f1c9d65a24d6b1b3933db5997a441a02ea863b41780f7387e4599008d79a96f1b01000000000000000000000000000000000000000000000000000000000000ff00000000000000000000000000000000000000000000000000000000000000'
  //   }
  //   const txn2 = await wallet.sendTransaction(txn)
  //   console.log(txn2)
  // })
})
