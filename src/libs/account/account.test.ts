import { beforeAll, describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { ethers } from 'ethers'
import { generateAddress2 } from '@nomicfoundation/ethereumjs-util/dist/account'
import { EmailVault } from '../emailVault/emailVault'
import { AccountController, getAccountDeployParams } from './account'
import { PrivLevels, getProxyDeployBytecode } from '../proxyDeploy/deploy'
import { requestMagicLink } from '../magicLink/magicLink'

const relayerUrl = 'http://localhost:1934'
const accountController = new AccountController(fetch, relayerUrl)
const baseIdentityAddr = '0x2A2b85EB1054d6f0c6c2E37dA05eD3E5feA684EF'
const emailVault = new EmailVault(fetch, relayerUrl)
let user: string
const salt = '0x0000000000000000000000000000000000000000000000000000000000000001'
const identityFactoryAddr = '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'
const feeCollector = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'
const threeDays = 259200
let identity: string
let email: string

function randomString(len: number) {
  let result = ''
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length
  let counter = 0
  while (counter < len) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  return result
}

describe('account controller', () => {
  // @TODO: RELAYER BREAKS ON BAD REQUESTS
  beforeEach(() => {
    const pk = `0x${Array.from(ethers.randomBytes(32), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')}`
    user = ethers.computeAddress(pk)

    email = `yosif+${randomString(5)}@ambire.com`
  })
  describe('positive tests', () => {
    test('create an account without email', async () => {
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

      const res = await accountController.createAccount(accountPresets, expectedAddr, {
        email: '',
        authKey: ''
      })
      expect(res).toHaveProperty('success', true)
      identity = expectedAddr
    })
    test('create an account with email', async () => {
      const keys = await requestMagicLink(email, relayerUrl, fetch)
      const authKey = keys.key
      const authSecret = keys.secret
      await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
      await emailVault.create(email, authKey)

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
      const res = await accountController.createAccount(accountPresets, expectedAddr, {
        email,
        authKey: authKey as string
      })
      expect(res).toHaveProperty('success', true)
      identity = expectedAddr
    })

    test('get account details', async () => {
      const res = await accountController.getAccount(identity)
      expect(res).toHaveProperty('_id', identity)
      expect(res).toHaveProperty('baseIdentityAddr', baseIdentityAddr)
      expect(res).toHaveProperty('bytecode')
      expect(res).toHaveProperty('identityFactoryAddr', identityFactoryAddr)
      expect(res).toHaveProperty('salt', salt)
      expect(res).toHaveProperty('created')
    })
    test('get accounts by email', async () => {
      const keys = await requestMagicLink(email, relayerUrl, fetch)
      const authKey = keys.key as string
      const authSecret = keys.secret
      await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
      await emailVault.create(email, authKey)

      // create account
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

      await accountController.createAccount(accountPresets, expectedAddr, {
        email,
        authKey: authKey as string
      })

      const res = await accountController.getAccountsByEmail(email, authKey)
      const record = res[0]
      expect(record).toHaveProperty('_id', expectedAddr)
      expect(record).toHaveProperty('baseIdentityAddr', baseIdentityAddr)
      expect(record).toHaveProperty('bytecode')
      expect(record).toHaveProperty('identityFactoryAddr', identityFactoryAddr)
      expect(record).toHaveProperty('salt', salt)
      expect(record).toHaveProperty('created')
      expect(record).toHaveProperty('meta', { email })
    })
  })
  describe('negative tests', () => {
    test('wrong identity address without email', async () => {
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

      const res = await accountController.createAccount(accountPresets, wrongExpectedAddress, {
        email: '',
        authKey: ''
      })
      // @NOTE: on wrong request relayer crashes: Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
      expect(res).toBe(
        'accountController: create account: provided address mismatches calculated address: ensure solc/adex-protocol-eth are the same versions as the relayer'
      )
    })
    test('wrong identity address with email', async () => {
      const keys = await requestMagicLink(email, relayerUrl, fetch)
      const authKey = keys.key
      const authSecret = keys.secret
      await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
      await emailVault.create(email, authKey)

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

      const res = await accountController.createAccount(accountPresets, wrongExpectedAddress, {
        email,
        authKey: authKey as string
      })
      // @NOTE: on wrong request relayer crashes: Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
      expect(res).toBe(
        'accountController: create account: provided address mismatches calculated address: ensure solc/adex-protocol-eth are the same versions as the relayer'
      )
    })
  })
})
