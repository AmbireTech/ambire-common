import { AbiCoder, Interface, parseEther } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { getAccountsInfo } from '../../../test/helpers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { execTransactionAbi } from '../../consts/safe'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { getRpcProvider } from '../../services/provider'
import { AccountOp } from '../accountOp/accountOp'
import { getBroadcastCalldata, getUserOperation } from './userOperation'

const to = '0x706431177041C87BEb1C25Fa29b92057Cb3c7089'

const optimism = networks.find((n) => n.chainId === 10n)!

const smartAccDeployed: Account = {
  addr: '0xcb2dF90Fb6b22A87Ce22A0D36f2EcA8ED1DD1A8b',
  initialPrivileges: [
    [
      '0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  creation: {
    factoryAddr: '0x681C1Fd13E45E7C3bfb6288Fd39c0cA552d92561',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027ff33cc417366b7e38d2706a67ab46f85465661c28b864b521441180d15df82251553d602d80604d3d3981f3363d3d373d3d3d363d7372d91da2b0c316d030e1ed840b80c9cd9ae445b65af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb'],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xcb2dF90Fb6b22A87Ce22A0D36f2EcA8ED1DD1A8b'
  }
}

const safeAccDeployed: Account = {
  addr: '0x8f27b8edeaabf040ae1572e8f7b35f91cb8f574a',
  initialPrivileges: [],
  creation: null,
  safeCreation: {
    factoryAddr: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
    singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
    saltNonce: '0x00',
    setupData: '0x',
    version: 'v1.4.1'
  },
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb'],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x8f27b8edeaabf040ae1572e8f7b35f91cb8f574a'
  }
}

const safeAccountState: AccountOnchainState = {
  accountAddr: safeAccDeployed.addr,
  isDeployed: true,
  eoaNonce: null,
  nonce: 7n,
  erc4337Nonce: 0n,
  associatedKeys: safeAccDeployed.associatedKeys,
  importedAccountKeys: [],
  balance: 0n,
  isEOA: false,
  isErc4337Enabled: false,
  isErc4337Nonce: false,
  isV2: false,
  currentBlock: 0n,
  isSmarterEoa: false,
  delegatedContract: null,
  delegatedContractName: null,
  threshold: 1,
  updatedAt: 0
}

describe('User Operation tests', () => {
  describe('Basic tests', () => {
    test('should include deploy code if the account is not deployed', async () => {
      const opOptimism: AccountOp = {
        accountAddr: smartAccDeployed.addr,
        signingKeyAddr: smartAccDeployed.associatedKeys[0]!,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        chainId: optimism.chainId,
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('10'), data: '0x' }],
        id: 'opt'
      }
      const usedNetworks = [optimism]
      const providers = {
        [optimism.chainId.toString()]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])
      const accountState = accountStates[smartAccDeployed.addr]![optimism.chainId.toString()]!
      accountState.isDeployed = false
      const userOp = getUserOperation({
        account: smartAccDeployed,
        accountState,
        accountOp: opOptimism,
        bundler: 'pimlico',
        entryPointSig: '0x0001'
      })
      expect(userOp).toHaveProperty('factory')
      expect(userOp).toHaveProperty('factoryData')
      expect(userOp.activatorCall).toBe(undefined)
    })
    test('should not include deploy code nor the activator call on a deployed account with entry point privs', async () => {
      const opOptimism: AccountOp = {
        accountAddr: smartAccDeployed.addr,
        signingKeyAddr: smartAccDeployed.associatedKeys[0]!,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        chainId: optimism.chainId,
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('10'), data: '0x' }],
        id: 'opt'
      }
      const usedNetworks = [optimism]
      const providers = {
        [optimism.chainId.toString()]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])
      const accountState = accountStates[smartAccDeployed.addr]![optimism.chainId.toString()]!
      const userOp = getUserOperation({
        account: smartAccDeployed,
        accountState,
        accountOp: opOptimism,
        bundler: 'pimlico'
      })
      expect(userOp).not.toHaveProperty('factory')
      expect(userOp).not.toHaveProperty('factoryData')
      expect(userOp.activatorCall).toBe(undefined)
    })
    test('should include activator call if the account is deployed but does not have entry point privs', async () => {
      const opOptimism: AccountOp = {
        accountAddr: smartAccDeployed.addr,
        signingKeyAddr: smartAccDeployed.associatedKeys[0]!,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        chainId: optimism.chainId,
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('10'), data: '0x' }],
        id: 'opt'
      }
      const usedNetworks = [optimism]
      const providers = {
        [optimism.chainId.toString()]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])
      const accountState = accountStates[smartAccDeployed.addr]![optimism.chainId.toString()]!
      accountState.isErc4337Enabled = false
      const userOp = getUserOperation({
        account: smartAccDeployed,
        accountState,
        accountOp: opOptimism,
        bundler: 'pimlico'
      })
      expect(userOp).not.toHaveProperty('factory')
      expect(userOp).not.toHaveProperty('factoryData')
      expect(userOp.activatorCall).toBe(undefined)
    })
    test('should keep the gas tank fee call outside the Safe broadcast txn', () => {
      const abiCoder = new AbiCoder()
      const safeCall = { to, value: parseEther('10'), data: '0x1234' }
      const feeCall = {
        to: FEE_COLLECTOR,
        value: 0n,
        data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 1n, 'USDC'])
      }
      const opOptimism: AccountOp = {
        accountAddr: safeAccDeployed.addr,
        signingKeyAddr: safeAccDeployed.associatedKeys[0]!,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        chainId: optimism.chainId,
        nonce: 0n,
        signature: '0x',
        calls: [safeCall],
        feeCall,
        id: 'opt'
      }

      const ambireAccount = new Interface(AmbireAccount.abi)
      const safeExec = new Interface(execTransactionAbi)
      const calldata = getBroadcastCalldata(safeAccDeployed, opOptimism, safeAccountState)
      const outerCalls = ambireAccount.decodeFunctionData('executeBySender', calldata)[0]
      const safeTxn = safeExec.decodeFunctionData('execTransaction', outerCalls[0].data)

      expect(outerCalls).toHaveLength(2)
      expect(outerCalls[0].to.toLowerCase()).toBe(safeAccDeployed.addr.toLowerCase())
      expect(outerCalls[1].to.toLowerCase()).toBe(feeCall.to.toLowerCase())
      expect(outerCalls[1].value).toBe(feeCall.value)
      expect(outerCalls[1].data).toBe(feeCall.data)
      expect(safeTxn.to.toLowerCase()).toBe(safeCall.to.toLowerCase())
      expect(safeTxn.value).toBe(safeCall.value)
      expect(safeTxn.data).toBe(safeCall.data)
    })
  })
})
