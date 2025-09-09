import { ControllerInterface } from './controller'

// @TODO add the controller
export type IContractNamesController = ControllerInterface<
  InstanceType<typeof import('../controllers/contractNames/contractNames').ContractNamesController>
>

// TODO add types
// type AddressState = {
//   fieldValue: string
//   ensAddress: string
//   isDomainResolving: boolean
// }

// type AddressStateOptional = {
//   fieldValue?: AddressState['fieldValue']
//   ensAddress?: AddressState['ensAddress']
//   isDomainResolving?: AddressState['isDomainResolving']
// }

// export type { AddressState, AddressStateOptional }
