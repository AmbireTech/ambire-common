import { beforeAll, describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { ethers } from 'ethers'
import { generateAddress2 } from '@nomicfoundation/ethereumjs-util/dist/account'
import { AccountController, getAccountDeployParams } from './account'
import { PrivLevels, getProxyDeployBytecode } from '../proxyDeploy/deploy'

const relayerUrl = 'http://localhost:1934'
const accountController = new AccountController(fetch, relayerUrl)

describe('account controller', () => {
  describe('positive tests', () => {
    test('create an account', async () => {
      const baseIdentityAddr = '0x2A2b85EB1054d6f0c6c2E37dA05eD3E5feA684EF'
      const pk = `0x${Array.from(ethers.randomBytes(32), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('')}`
      const user = ethers.computeAddress(pk)

      const accountPresets = {
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
        identityFactoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        baseIdentityAddr,
        feeCollector: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
        bytecode: '',
        quickAccTimelock: 259200 // 3 days
      }
      const privileges: PrivLevels[] = [
        { addr: baseIdentityAddr, hash: ethers.toBeHex(1, 32) },
        { addr: user, hash: ethers.toBeHex(2, 32) }
      ]
      const bytecode = getProxyDeployBytecode(accountPresets.baseIdentityAddr, privileges, {
        privSlot: 0
      })

      const expectedAddr = ethers.getAddress(
        `0x${generateAddress2(
          Buffer.from(accountPresets.identityFactoryAddr.slice(2), 'hex'),
          Buffer.from(accountPresets.salt.slice(2), 'hex'),
          Buffer.from(bytecode.slice(2), 'hex')
        ).toString('hex')}`
      )
      accountPresets.bytecode = bytecode

      await accountController.createAccount(accountPresets, expectedAddr, privileges)
    })
  })
})
