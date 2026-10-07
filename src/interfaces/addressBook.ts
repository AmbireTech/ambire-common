import { Account } from './account'
import { ControllerInterface } from './controller'

export type Contact = {
  name: string
  address: Account['addr']
  isWalletAccount?: boolean
  createdAt?: number
  updatedAt?: number
}

export type Contacts = Array<Contact>

export type IAddressBookController = ControllerInterface<
  InstanceType<typeof import('../controllers/addressBook/addressBook').AddressBookController>
>
