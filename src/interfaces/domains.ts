import { ControllerInterface } from './controller'

export type IDomainsController = ControllerInterface<
  InstanceType<typeof import('../controllers/domains/domains').DomainsController>
>

type AddressState = {
  fieldValue: string
  ensAddress: string
  isDomainResolving: boolean
}

type AddressStateOptional = {
  fieldValue?: AddressState['fieldValue']
  ensAddress?: AddressState['ensAddress']
  isDomainResolving?: AddressState['isDomainResolving']
}

export type { AddressState, AddressStateOptional }
