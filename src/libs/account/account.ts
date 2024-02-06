import { ethers, Interface } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET } from '../../consts/derivation'
import { Account } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { AccountPreferences, KeyPreferences } from '../../interfaces/settings'
import { DKIM_VALIDATOR_ADDR, getSignerKey, RECOVERY_DEFAULTS } from '../dkim/recovery'
import { KnownAddressLabels } from '../humanizer/interfaces'
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
  // for EOAs, we do not throw an error anymore as we need fake
  // values for the simulation
  if (account.creation === null) return [ethers.ZeroAddress, '0x']

  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export function getBasicAccount(key: string): Account {
  return {
    addr: key,
    associatedKeys: [key],
    initialPrivileges: [],
    creation: null
  }
}

export async function getSmartAccount(privileges: PrivLevels[]): Promise<Account> {
  const bytecode = await getBytecode(privileges)

  return {
    addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
    initialPrivileges: privileges.map((priv) => [priv.addr, priv.hash]),
    associatedKeys: privileges.map((priv) => priv.addr),
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
  // const domain: string = recoveryInfo.emailFrom.split('@')[1]

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

export const isSmartAccount = (account: Account) => !!account.creation

/**
 * Checks if a (basic) EOA account is a derived one,
 * that is meant to be used as a smart account key only.
 */
export const isDerivedForSmartAccountKeyOnly = (index: number) =>
  index >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET

/**
 * Map account addresses to their respective labels (if they have ones) in order
 * to display user-friendly labels instead of raw addresses. The addresses
 * for which there is a label are considered "known addresses".
 */
export const getKnownAddressLabels = (
  accounts: Account[],
  accountPreferences: AccountPreferences,
  keys: Key[],
  keyPreferences: KeyPreferences
): KnownAddressLabels => {
  const knownAddressLabels: KnownAddressLabels = {}

  // Check if the address is in the key preferences (lowest priority)
  keys.forEach((key) => {
    // Note: not using .findLast, because it's not compatible with TypeScript, blah
    const filteredKeyPreferences = keyPreferences.filter((x) => x.addr === key.addr && !!x.label)
    // There could be more than one, since there could be more than one key
    // with the same address. In that case, the last (probably newest) one wins.
    const currentKeyPreferences = filteredKeyPreferences[filteredKeyPreferences.length - 1]
    if (currentKeyPreferences) {
      knownAddressLabels[key.addr] = currentKeyPreferences.label
    }
  })

  // TODO: Check if the address is in the address book (second lowest)

  // Check if address is in the account preferences (highest priority)
  accounts.forEach((acc) => {
    const accPref = accountPreferences[acc.addr]
    if (accPref?.label) {
      knownAddressLabels[acc.addr] = accPref.label
    }
  })

  return knownAddressLabels
}

export const getDefaultSelectedAccount = (accounts: Account[]) => {
  if (accounts.length === 0) return null

  const smartAccounts = accounts.filter((acc) => acc.creation)
  if (smartAccounts.length) return smartAccounts[0]

  return accounts[0]
}
