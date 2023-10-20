import { ethers, Interface } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { getPublicKeyIfAny } from '../dkim/getPublicKey'
import publicKeyToComponents from '../dkim/publicKeyToComponents'
import {
  DKIM_VALIDATOR_ADDR,
  frequentlyUsedSelectors,
  getSignerKey,
  knownSelectors,
  RECOVERY_DEFAULTS
} from '../dkim/recovery'
import { getBytecode } from '../proxyDeploy/bytecode'
import { PrivLevels } from '../proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'

/**
 * The minimum requirements are emailFrom and secondaryKey.
 * - emailFrom is the email from the email vault
 * - secondaryKey is the recoveryKey set in the email vault
 * - acceptUnknownSelectors: sets whether recovery can be done by DNSSEC keys
 * - waitUntilAcceptAdded: how much time to wait before the user accepts
 * a DNSSEC key
 * - waitUntilAcceptRemoved: how much time to wait before the user accepts
 * a removal of a DNSSEC key
 * - acceptEmptyDKIMSig: can recovery be performed without DKIM
 * - acceptEmptySecondSig: can recovery be performed without secondaryKey
 * - onlyOneSigTimelock: in case of 1/2 multisig, how much time to wait
 * before the recovery transaction can be executed
 */
interface DKIMRecoveryAccInfo {
  emailFrom: string
  secondaryKey: string
  waitUntilAcceptAdded?: BigInt
  waitUntilAcceptRemoved?: BigInt
  acceptEmptyDKIMSig?: boolean
  acceptEmptySecondSig?: boolean
  onlyOneSigTimelock?: BigInt
}

// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  if (account.creation === null) throw new Error('tried to get deployment params for an EOA')
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export function getLegacyAccount(key: string): Account {
  return {
    addr: key,
    label: '',
    pfp: '',
    associatedKeys: [key],
    initialPrivileges: [],
    creation: null
  }
}

export async function getSmartAccount(privileges: PrivLevels[]): Promise<Account> {
  const bytecode = await getBytecode(privileges)
  return {
    addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
    label: '',
    pfp: '',
    associatedKeys: privileges.map((priv) => priv.addr),
    initialPrivileges: privileges.map((priv) => [priv.addr, priv.hash]),
    creation: {
      factoryAddr: AMBIRE_ACCOUNT_FACTORY,
      bytecode,
      salt: ethers.toBeHex(0, 32)
    }
  }
}

/**
 * Create a DKIM recoverable email smart account
 *
 * @param recoveryInfo DKIMRecoveryAccInfo
 * @param associatedKey the key that has privileges
 * @returns Promise<Account>
 */
export async function getEmailAccount(
  recoveryInfo: DKIMRecoveryAccInfo,
  associatedKey: string
): Promise<Account> {
  const domain: string = recoveryInfo.emailFrom.split('@')[1]

  // TODO: make getEmailAccount work with cloudflare

  // try to take the dkimKey from the list of knownSelectors
  // if we cannot, we query a list of frequentlyUsedSelectors to try
  // to find the dkim key
  // let selector = knownSelectors[domain as keyof typeof knownSelectors] ?? ''
  // let dkimKey = selector ? await getPublicKeyIfAny({domain, selector: selector}) : ''
  // if (!dkimKey) {
  //   const promises = frequentlyUsedSelectors.map(sel => getPublicKeyIfAny({domain, selector: sel}))
  //   const results = await Promise.all(promises)
  //   for (let i = 0; i < results.length; i++) {
  //     if (results[i]) {
  //       dkimKey = results[i]
  //       selector = frequentlyUsedSelectors[i]
  //       break
  //     }
  //   }
  // }

  // if there's no dkimKey, standard DKIM recovery is not possible
  // we leave the defaults empty and the user will have to rely on
  // keys added through DNSSEC
  const selector = ethers.hexlify(ethers.toUtf8Bytes(''))
  const modulus = ethers.hexlify(ethers.toUtf8Bytes(''))
  const exponent = ethers.hexlify(ethers.toUtf8Bytes(''))
  // if (dkimKey) {
  //   const key = publicKeyToComponents(dkimKey.publicKey)
  //   modulus = ethers.hexlify(key.modulus)
  //   exponent = ethers.hexlify(ethers.toBeHex(key.exponent))
  // }

  // acceptUnknownSelectors should be always true
  // and should not be overriden by the FE at this point
  const acceptUnknownSelectors = RECOVERY_DEFAULTS.acceptUnknownSelectors
  const waitUntilAcceptAdded =
    recoveryInfo.waitUntilAcceptAdded ?? RECOVERY_DEFAULTS.waitUntilAcceptAdded
  const waitUntilAcceptRemoved =
    recoveryInfo.waitUntilAcceptRemoved ?? RECOVERY_DEFAULTS.waitUntilAcceptRemoved
  const acceptEmptyDKIMSig = recoveryInfo.acceptEmptyDKIMSig ?? RECOVERY_DEFAULTS.acceptEmptyDKIMSig
  const acceptEmptySecondSig =
    recoveryInfo.acceptEmptySecondSig ?? RECOVERY_DEFAULTS.acceptEmptySecondSig
  const onlyOneSigTimelock = recoveryInfo.onlyOneSigTimelock ?? RECOVERY_DEFAULTS.onlyOneSigTimelock

  const abiCoder = new ethers.AbiCoder()
  const validatorAddr = DKIM_VALIDATOR_ADDR
  const validatorData = abiCoder.encode(
    ['tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'],
    [
      [
        recoveryInfo.emailFrom,
        RECOVERY_DEFAULTS.emailTo,
        selector,
        modulus,
        exponent,
        recoveryInfo.secondaryKey,
        acceptUnknownSelectors,
        waitUntilAcceptAdded,
        waitUntilAcceptRemoved,
        acceptEmptyDKIMSig,
        acceptEmptySecondSig,
        onlyOneSigTimelock
      ]
    ]
  )
  const { hash } = getSignerKey(validatorAddr, validatorData)
  const privileges = [{ addr: associatedKey, hash }]
  return getSmartAccount(privileges)
}

export const isAmbireV1LinkedAccount = (factoryAddr?: string) =>
  factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'
