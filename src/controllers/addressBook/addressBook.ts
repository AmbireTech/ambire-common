import { getAddress } from 'ethers'

import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

export type Contacts = Array<{
  name: string
  address: string
  isWalletAccount?: boolean
}>

/**
 * Address Book controller
 */

export class AddressBookController extends EventEmitter {
  // Manually added contact (stored in storage)
  #manuallyAddedContacts: Contacts = []

  // Contacts, generated on the fly from the accounts in the wallet (not stored in storage)
  #walletAccountSourcedContacts: Contacts = []

  #storage: Storage

  #initialLoadPromise: Promise<void>

  constructor(storage: Storage) {
    super()

    this.#storage = storage
    this.#initialLoadPromise = this.#load()
  }

  set accountsInWalletContacts(accountsInWalletContacts: Contacts) {
    this.#walletAccountSourcedContacts = accountsInWalletContacts.map((contact) => ({
      ...contact,
      isWalletAccount: true
    }))
    this.emitUpdate()
  }

  get contacts() {
    return [...this.#manuallyAddedContacts, ...this.#walletAccountSourcedContacts]
  }

  async #load() {
    try {
      this.#manuallyAddedContacts = await this.#storage.get('contacts', [])
      this.emitUpdate()
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Address Book. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('Address Book: failed to load contacts from the Address Book')
      })
    }
  }

  #handleManuallyAddedContactsChange() {
    this.emitUpdate()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('contacts', this.#manuallyAddedContacts)
  }

  #findManuallyAddedContactWithAddress(address: string) {
    return this.#manuallyAddedContacts.find(
      (contact) => contact.address.toLowerCase() === address.toLowerCase()
    )
  }

  #findContactWithAddress(address: string) {
    return !this.contacts.some((contact) => contact.address.toLowerCase() === address.toLowerCase())
  }

  #getChecksummedAddress(address: string) {
    try {
      return getAddress(address)
    } catch {
      this.emitError({
        message: 'Invalid address',
        level: 'minor',
        error: new Error('Address Book: invalid address')
      })
      return ''
    }
  }

  async addContact(name: string, address: string) {
    await this.#initialLoadPromise
    const checksummedAddress = this.#getChecksummedAddress(address)
    const trimmedName = name.trim()

    if (!this.#findContactWithAddress(checksummedAddress)) {
      this.emitError({
        message: 'Contact with this address already exists in the Address Book',
        level: 'minor',
        error: new Error(
          'Address Book: contact with this address already exists in the Address Book'
        )
      })
      return
    }

    this.#manuallyAddedContacts.push({ name: trimmedName, address: checksummedAddress })

    this.#handleManuallyAddedContactsChange()
  }

  async renameManuallyAddedContact(address: string, newName: string) {
    await this.#initialLoadPromise
    const checksummedAddress = this.#getChecksummedAddress(address)
    const trimmedNewName = newName.trim()

    if (!this.#findManuallyAddedContactWithAddress(checksummedAddress)) {
      this.emitError({
        message: "Can't rename contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't rename contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    this.#manuallyAddedContacts = this.#manuallyAddedContacts.map((contact) => {
      if (contact.address.toLowerCase() === address.toLowerCase()) {
        return { name: trimmedNewName, address: contact.address }
      }

      return contact
    })

    this.#handleManuallyAddedContactsChange()
  }

  async removeManuallyAddedContact(address: string) {
    await this.#initialLoadPromise
    const checksummedAddress = this.#getChecksummedAddress(address)

    if (!this.#findManuallyAddedContactWithAddress(checksummedAddress)) {
      this.emitError({
        message: "Can't remove contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't remove contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    this.#manuallyAddedContacts = this.#manuallyAddedContacts.filter(
      (contact) => contact.address.toLowerCase() !== address.toLowerCase()
    )

    this.#handleManuallyAddedContactsChange()
  }

  toJSON() {
    return {
      ...this,
      contacts: this.contacts
    }
  }
}
