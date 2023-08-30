import { describe, expect, test } from '@jest/globals'
import { JsonRpcProvider, ethers } from 'ethers'
import { getAccountState } from './accountState'
import { networks } from '../../consts/networks'
import { get4437Bytecode, getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { AMBIRE_ACCOUNT_FACTORY, AMBIRE_ACCOUNT_FACTORY_ERC_4337, ERC_4337_ENTRYPOINT } from '../../consts/deploy'

const polygon = networks.find((x) => x.id === 'polygon')
if (!polygon) throw new Error('unable to find polygon network in consts')
const provider = new JsonRpcProvider(polygon.rpcUrl)

describe('AccountState', () => {
  test('should get the account state and check if a v1 address and v2 address (not deployed) are returned correctly', async () => {
    const account = {
      addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
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

    const accountEOA = {
      addr: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
      label: '',
      pfp: '',
      associatedKeys: [],
      creation: {
        factoryAddr: '0x0000000000000000000000000000000000000000',
        bytecode: '0x00',
        salt: '0x0'
      }
    }

    const signerAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const priv = { addr: signerAddr, hash: true }
    const bytecode = await getBytecode(polygon, [priv])
    const accountNotDeployed = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
      label: 'test account',
      pfp: 'pfp',
      associatedKeys: [signerAddr],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(0, 32)
      }
    }

    const account4337 = {
      addr: '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971',
      label: '',
      pfp: '',
      associatedKeys: ['0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7', ERC_4337_ENTRYPOINT],
      creation: {
        factoryAddr: '0xA3A22Bf212C03ce55eE7C3845D4c177a6fEC418B',
        bytecode:
          '0x60017fbacd3e9e8aed42b26f997f28d90ae31f73d67222ec769cf7d8552e5f95f8f48d5560017f1937f135cfb1fb953b515a8d5a0f5ab4b8f1cdca7d9080fc3462633d71b5eb05553d602d8060523d3981f3363d3d373d3d3d363d73ff69afde895b381ee71e17c60350ae4c70b16a925af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
      }
    }

    const privs = [
      { addr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7', hash: true },
      { addr: '0x43Ec7De60E89dabB7cAedc89Cd1F3c8D52707312', hash: true }
    ]
    const bytecodeErc4337 = await get4437Bytecode(polygon, privs)
    const accountErc4337 = {
      addr: '0x76b277955846313Ec50F26eD155C26f5aED295B1',
      label: '',
      pfp: '',
      associatedKeys: ['0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7', '0x43Ec7De60E89dabB7cAedc89Cd1F3c8D52707312'],
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY_ERC_4337,
        bytecode: bytecodeErc4337,
        salt: '0x0'
      }
    }

    const accounts = [account, accountNotDeployed, accountEOA, account4337, accountErc4337]
    const state: any = await getAccountState(provider, polygon, accounts)
    console.log(state)
    expect(state.length).toBe(5)

    const v1Acc = state[0]
    expect(v1Acc.isEOA).toBe(false)
    expect(v1Acc.isV2).toBeFalsy()
    expect(v1Acc.isDeployed).toBeTruthy()

    const v2Acc = state[1]
    expect(v2Acc.isV2).toBeTruthy()
    expect(v2Acc.isEOA).toBe(false)
    expect(v2Acc.isDeployed).toBeFalsy()

    const eoaAcc = state[2]
    expect(eoaAcc.isEOA).toBe(true)
    expect(eoaAcc.balance).toBeGreaterThan(0n)

    const acc4337 = state[3]
    expect(acc4337.isErc4337Enabled).toBe(true)
    expect(acc4337.isErc4337Nonce).toBe(true)
    expect(acc4337.nonce).toBeGreaterThanOrEqual(0)

    const acc4337deployed = state[4]
    expect(acc4337deployed.isErc4337Enabled).toBe(true)
    expect(acc4337deployed.isErc4337Nonce).toBe(true)
    expect(acc4337deployed.nonce).toBeGreaterThanOrEqual(0)
    expect(acc4337deployed.associatedKeys).toHaveProperty(ERC_4337_ENTRYPOINT)
    expect(acc4337deployed.associatedKeys[ERC_4337_ENTRYPOINT]).toBe('0x42144640c7cb5ff8aa9595ae175ffcb6dd152db6e737c13cc2d5d07576967020')
  })
})
