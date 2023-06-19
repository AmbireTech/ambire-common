import { beforeAll, describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { ethers } from 'ethers'
import { generateAddress2 } from '@nomicfoundation/ethereumjs-util/dist/account'
import { AccountController, getAccountDeployParams } from './account'
import { PrivLevels, getProxyDeployBytecode } from '../proxyDeploy/deploy'

const relayerUrl = 'http://localhost:1934'
const accountController = new AccountController(fetch, relayerUrl)
const baseIdentityAddr = '0x2A2b85EB1054d6f0c6c2E37dA05eD3E5feA684EF'
let user: string
const salt = '0x0000000000000000000000000000000000000000000000000000000000000001'
const identityFactoryAddr = '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'
const feeCollector = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'
const threeDays = 259200
let identity: string
describe('account controller', () => {
  // @TODO: RELAYER BREAKS ON BAD REQUESTS
  beforeEach(() => {
    const pk = `0x${Array.from(ethers.randomBytes(32), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')}`
    user = ethers.computeAddress(pk)
  })
  describe('positive tests', () => {
    test('create an account', async () => {
      const privileges: PrivLevels[] = [
        { addr: baseIdentityAddr, hash: ethers.toBeHex(1, 32) },
        { addr: user, hash: ethers.toBeHex(2, 32) }
      ]
      const accountPresets = {
        salt,
        identityFactoryAddr,
        baseIdentityAddr,
        feeCollector,
        bytecode: '',
        quickAccTimelock: threeDays,
        privileges
      }
      const bytecode = getProxyDeployBytecode(baseIdentityAddr, privileges, {
        privSlot: 0
      })

      const expectedAddr = ethers.getAddress(
        `0x${generateAddress2(
          Buffer.from(identityFactoryAddr.slice(2), 'hex'),
          Buffer.from(salt.slice(2), 'hex'),
          Buffer.from(bytecode.slice(2), 'hex')
        ).toString('hex')}`
      )
      accountPresets.bytecode = bytecode

      const res = await accountController.createAccount(accountPresets, expectedAddr)
      expect(res).toHaveProperty('success', true)
      identity = expectedAddr
    })
    test('get account', async () => {
      const res = await accountController.getAccount(identity)
      expect(res).toHaveProperty('_id', identity)
      expect(res).toHaveProperty('baseIdentityAddr', baseIdentityAddr)
      expect(res).toHaveProperty('bytecode')
      expect(res).toHaveProperty('identityFactoryAddr', identityFactoryAddr)
      expect(res).toHaveProperty('salt', salt)
      expect(res).toHaveProperty('created')
    })
  })
  describe('negative tests', () => {
    test('wrong identity address', async () => {
      const privileges: PrivLevels[] = [
        { addr: baseIdentityAddr, hash: ethers.toBeHex(1, 32) },
        { addr: user, hash: ethers.toBeHex(2, 32) }
      ]
      const accountPresets = {
        salt,
        identityFactoryAddr,
        baseIdentityAddr,
        feeCollector,
        bytecode: '',
        quickAccTimelock: threeDays,
        privileges
      }
      const bytecode = getProxyDeployBytecode(baseIdentityAddr, privileges, {
        privSlot: 0
      })

      const pk = `0x${Array.from(ethers.randomBytes(32), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('')}`
      const wrongExpectedAddress = ethers.computeAddress(pk)
      accountPresets.bytecode = bytecode

      const res = await accountController.createAccount(accountPresets, wrongExpectedAddress)
      // @NOTE: on wrong request relayer crashes: Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
      expect(res).toBe(
        'accountController: create account: provided address mismatches calculated address: ensure solc/adex-protocol-eth are the same versions as the relayer'
      )
    })
  })
})
