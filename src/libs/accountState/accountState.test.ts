import { describe, expect, test } from '@jest/globals'
import { JsonRpcProvider, ethers } from 'ethers'
import { getAccountState } from './accountState'
import { networks } from '../../consts/networks'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'

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

    const accounts = [account, accountNotDeployed, accountEOA]
    const state: any = await getAccountState(provider, polygon, accounts)
    expect(state.length).toBe(3)

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
  })
})
