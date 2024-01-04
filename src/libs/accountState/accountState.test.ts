import { ethers, JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'

import { describe, expect, test } from '@jest/globals'

import {
  AMBIRE_ACCOUNT_FACTORY,
  ENTRY_POINT_MARKER,
  ERC_4337_ENTRYPOINT
} from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { getBytecode, get4437Bytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { getAccountState } from './accountState'
// import { get4437Bytecode } from ''

const polygon = networks.find((x) => x.id === 'polygon')
if (!polygon) throw new Error('unable to find polygon network in consts')
const provider = new JsonRpcProvider(polygon.rpcUrl)

describe('AccountState', () => {
  test('should get the account state and check if a v1 address and v2 address (not deployed) are returned correctly', async () => {
    const account: Account = {
      addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      associatedKeys: [],
      initialPrivileges: [],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
      }
    }

    const accountEOA: Account = {
      addr: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
      associatedKeys: [],
      initialPrivileges: [],
      creation: {
        factoryAddr: '0x0000000000000000000000000000000000000000',
        bytecode: '0x00',
        salt: '0x0'
      }
    }

    const accountEOANonceNonZero = {
      addr: '0xf5ffA17725754dC00adB255fF296E4177B0982c7',
      associatedKeys: [],
      initialPrivileges: [],
      creation: {
        factoryAddr: '0x0000000000000000000000000000000000000000',
        bytecode: '0x00',
        salt: '0x0'
      }
    }

    const signerAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const privileges = [
      {
        addr: signerAddr,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    ]
    const bytecode = await getBytecode(privileges)
    const accountNotDeployed: Account = {
      addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
      associatedKeys: [signerAddr],
      initialPrivileges: privileges.map((priv) => [priv.addr, priv.hash]),
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode,
        salt: ethers.toBeHex(0, 32)
      }
    }

    const privs4337 = [
      {
        addr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      { addr: ERC_4337_ENTRYPOINT, hash: ENTRY_POINT_MARKER }
    ]
    const account4337: Account = {
      addr: '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971',
      associatedKeys: ['0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7', ERC_4337_ENTRYPOINT],
      initialPrivileges: privs4337.map((priv) => [priv.addr, priv.hash]),
      creation: {
        factoryAddr: '0xA3A22Bf212C03ce55eE7C3845D4c177a6fEC418B',
        bytecode:
          '0x60017fbacd3e9e8aed42b26f997f28d90ae31f73d67222ec769cf7d8552e5f95f8f48d5560017f1937f135cfb1fb953b515a8d5a0f5ab4b8f1cdca7d9080fc3462633d71b5eb05553d602d8060523d3981f3363d3d373d3d3d363d73ff69afde895b381ee71e17c60350ae4c70b16a925af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
      }
    }

    const privs = [
      {
        addr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      {
        addr: '0x43Ec7De60E89dabB7cAedc89Cd1F3c8D52707312',
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    ]
    const bytecodeErc4337 = await get4437Bytecode(polygon, privs)

    const accountErc4337: Account = {
      addr: '0x76b277955846313Ec50F26eD155C26f5aED295B1',
      associatedKeys: [
        '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
        '0x43Ec7De60E89dabB7cAedc89Cd1F3c8D52707312'
      ],
      initialPrivileges: privs.map((priv) => [priv.addr, priv.hash]),
      creation: {
        factoryAddr: AMBIRE_ACCOUNT_FACTORY,
        bytecode: bytecodeErc4337,
        salt: '0x0'
      }
    }

    const accounts: Account[] = [
      account,
      accountNotDeployed,
      accountEOA,
      account4337,
      accountErc4337,
      accountEOANonceNonZero
    ]
    const state: any = await getAccountState(provider, polygon, accounts)

    expect(state.length).toBe(6)

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
    expect(acc4337.nonce).toBeGreaterThanOrEqual(0n)

    const acc4337deployed = state[4]
    expect(acc4337deployed.nonce).toBeGreaterThanOrEqual(0n)
    // TODO: polygon is no longer the erc-4337 network so the below is not valid
    // expect(acc4337deployed.associatedKeys).toHaveProperty(ERC_4337_ENTRYPOINT)

    const accEOANonZero = state[5]
    expect(accEOANonZero.isEOA).toBe(true)
    expect(accEOANonZero.nonce).toBeGreaterThan(0n)
  })
})
