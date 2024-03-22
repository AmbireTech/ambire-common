import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

type Contacts = Array<{
  name: string
  address: string
}>

/**
 * Address Book controller
 */

export class AddressBookController extends EventEmitter {
  contacts: Contacts = []

  #storage: Storage

  constructor(storage: Storage) {
    super()

    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#load()
  }

  async #load() {
    try {
      this.contacts = await this.#storage.get('contacts', [])
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Address Book. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('Address Book: failed to load contacts from the Address Book')
      })
    }
  }

  #saveContactsInStorage() {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('contacts', this.contacts)
  }

  #getContactFromName(name: string) {
    return this.contacts.find((contact) => contact.name === name)
  }

  #getContactFromAddress(address: string) {
    return this.contacts.find((contact) => contact.address === address)
  }

  addContact(name: string, address: string) {
    if (this.#getContactFromName(name)) {
      this.emitError({
        message: 'Contact with this name already exists in the Address Book',
        level: 'minor',
        error: new Error('Address Book: contact with this name already exists in the Address Book')
      })
      return
    }

    if (this.#getContactFromAddress(address)) {
      this.emitError({
        message: 'Contact with this address already exists in the Address Book',
        level: 'minor',
        error: new Error(
          'Address Book: contact with this address already exists in the Address Book'
        )
      })
      return
    }

    this.contacts.push({ name, address })

    this.#saveContactsInStorage()
  }

  renameContact(oldName: string, newName: string) {
    if (!this.#getContactFromName(oldName)) {
      this.emitError({
        message: "Can't rename contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't rename contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    if (this.#getContactFromName(newName)) {
      this.emitError({
        message: 'Contact with this name already exists in the Address Book',
        level: 'minor',
        error: new Error('Address Book: contact with this name already exists in the Address Book')
      })
      return
    }

    this.contacts = this.contacts.map((contact) => {
      if (contact.name === oldName) {
        return { name: newName, address: contact.address }
      }
      return contact
    })

    this.#saveContactsInStorage()
  }

  removeContact(name: string) {
    if (!this.#getContactFromName(name)) {
      this.emitError({
        message: "Can't remove contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't remove contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    this.contacts = this.contacts.filter((contact) => contact.name !== name)

    this.#saveContactsInStorage()
  }
}
