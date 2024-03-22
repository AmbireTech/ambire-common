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
  #accountsInWalletContacts: Contacts = []

  #storage: Storage

  constructor(storage: Storage) {
    super()

    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#load()
  }

  set accountsInWalletContacts(accountsInWalletContacts: Contacts) {
    this.#accountsInWalletContacts = accountsInWalletContacts.map((contact) => ({
      ...contact,
      isWalletAccount: true
    }))
    this.emitUpdate()
  }

  get contacts() {
    return [...this.#manuallyAddedContacts, ...this.#accountsInWalletContacts]
  }

  async #load() {
    try {
      this.#manuallyAddedContacts = await this.#storage.get('contacts', [])
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

  #getManuallyAddedContact(key: 'name' | 'address', value: string) {
    return this.#manuallyAddedContacts.find((contact) => contact[key] === value)
  }

  #getIsUnique(key: 'name' | 'address', value: string) {
    return !this.contacts.some((contact) => contact[key] === value)
  }

  addContact(name: string, address: string) {
    if (!this.#getIsUnique('name', name)) {
      this.emitError({
        message: 'Contact with this name already exists in the Address Book',
        level: 'minor',
        error: new Error('Address Book: contact with this name already exists in the Address Book')
      })
      return
    }

    if (!this.#getIsUnique('address', address)) {
      this.emitError({
        message: 'Contact with this address already exists in the Address Book',
        level: 'minor',
        error: new Error(
          'Address Book: contact with this address already exists in the Address Book'
        )
      })
      return
    }

    this.#manuallyAddedContacts.push({ name, address })

    this.#handleManuallyAddedContactsChange()
  }

  renameManuallyAddedContact(address: string, newName: string) {
    if (!this.#getManuallyAddedContact('address', address)) {
      this.emitError({
        message: "Can't rename contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't rename contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    if (!this.#getIsUnique('name', newName)) {
      this.emitError({
        message: 'Contact with this name already exists in the Address Book',
        level: 'minor',
        error: new Error('Address Book: contact with this name already exists in the Address Book')
      })
      return
    }

    this.#manuallyAddedContacts = this.#manuallyAddedContacts.map((contact) => {
      if (contact.address === address) {
        return { name: newName, address: contact.address }
      }

      return contact
    })

    this.#handleManuallyAddedContactsChange()
  }

  removeManuallyAddedContact(address: string) {
    if (!this.#getManuallyAddedContact('address', address)) {
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
      (contact) => contact.address !== address
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
