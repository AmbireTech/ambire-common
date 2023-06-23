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
let pk: string
let authKey: string
let expectedAddr: string
let accountPresets: any
let privileges: PrivLevels[]
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
  beforeEach(async () => {
    // initial vars
    pk = `0x${Array.from(ethers.randomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )}`
    user = ethers.computeAddress(pk)

    email = `yosif+${randomString(5)}@ambire.com`
  })
  describe('positive tests', () => {
    beforeEach(async () => {
      // confirm email addr
      const keys = await requestMagicLink(email, relayerUrl, fetch)
      authKey = keys.key as string
      const authSecret = keys.secret
      await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
      await emailVault.create(email, authKey)

      // generate vars for creating an account (not creatin an account)
      privileges = [
        { addr: baseIdentityAddr, hash: ethers.toBeHex(1, 32) },
        { addr: user, hash: ethers.toBeHex(2, 32) }
      ]
      accountPresets = {
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

      expectedAddr = ethers.getAddress(
        `0x${generateAddress2(
          Buffer.from(identityFactoryAddr.slice(2), 'hex'),
          Buffer.from(salt.slice(2), 'hex'),
          Buffer.from(bytecode.slice(2), 'hex')
        ).toString('hex')}`
      )
      accountPresets.bytecode = bytecode
    })
    describe('create account', () => {
      test('create an account without email', async () => {
        const res = await accountController.createAccount(accountPresets, expectedAddr, {
          email: '',
          authKey: ''
        })
        expect(res).toHaveProperty('success', true)
        identity = expectedAddr
      })
      test('create an account with email', async () => {
        const res = await accountController.createAccount(accountPresets, expectedAddr, {
          email,
          authKey: authKey as string
        })
        expect(res).toHaveProperty('success', true)
        identity = expectedAddr
      })
    })
    describe('use created account functoinalities', () => {
      beforeEach(async () => {
        await accountController.createAccount(accountPresets, expectedAddr, {
          email,
          authKey: authKey as string
        })
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
      test('get privileges', async () => {
        const res = await accountController.getPrivileges(expectedAddr, 'ethereum')

        expect(res.privileges).toHaveProperty(privileges[0].addr, privileges[0].hash)
        expect(res.privileges).toHaveProperty(privileges[1].addr, privileges[1].hash)
        expect(res).toHaveProperty('updatedBlock')
      })
      test('get privileges', async () => {
        const res = await accountController.getAccountNonce(expectedAddr, 'ethereum')
        expect(res).toHaveProperty('nonce', 0)
        expect(res).toHaveProperty('nextNonMinedNonce', 0)
        expect(res).toHaveProperty('pendingBundle', null)
      })
      test('estimate', async () => {
        const txns = [[expectedAddr, '0x01', '0x00']]
        const signer = { address: expectedAddr }
        const args = { txns, signer }
        const res = await accountController.estimate(expectedAddr, 'ethereum', args)
        expect(res.success).toBeTruthy()
      })
      test('get identities from signer', async () => {
        const signer = new ethers.Wallet(pk)
        const signature = await signer.signMessage('get_identity_from_signer')
        const res = await accountController.getAccountsBySigner(signature)
        const newPrivs = accountPresets.privileges.map((el: any) => [el.addr, el.hash])
        expect(res.success).toBeTruthy()
        // .toEqual instead of .toBE
        expect(res.identities[0]).toEqual({
          id: expectedAddr,
          baseIdentityAddr: accountPresets.baseIdentityAddr,
          identityFactoryAddr: accountPresets.identityFactoryAddr,
          email,
          salt: accountPresets.salt,
          bytecode: accountPresets.bytecode,
          privileges: newPrivs
        })
      })
    })
  })

  describe('negative tests', () => {
    test('wrong identity address without email', async () => {
      privileges = [
        { addr: baseIdentityAddr, hash: ethers.toBeHex(1, 32) },
        { addr: user, hash: ethers.toBeHex(2, 32) }
      ]
      accountPresets = {
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

      pk = `0x${Array.from(ethers.randomBytes(32), (byte) =>
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
      authKey = keys.key as string
      const authSecret = keys.secret
      await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
      await emailVault.create(email, authKey)

      privileges = [
        { addr: baseIdentityAddr, hash: ethers.toBeHex(1, 32) },
        { addr: user, hash: ethers.toBeHex(2, 32) }
      ]
      accountPresets = {
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

      pk = `0x${Array.from(ethers.randomBytes(32), (byte) =>
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
