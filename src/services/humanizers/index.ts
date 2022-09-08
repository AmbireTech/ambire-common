import UniRouters from './UniRouters'
import ERC20 from './ERC20'
import AaveLendingPoolV2 from './AaveLendingPoolV2'
import ERC721 from './ERC721'
import WETH from './WETH'
import AmbireIdentity from './AmbireIdentity'
import AmbireFactory from './AmbireFactory'
import YearnTesseractVault from './YearnTesseractVault'
import Movr from './Movr'
import OpenSea from './OpenSea'
import WALLETSupplyController from './WALLETSupplyController'
import AmbireBatcher from './AmbireBatcher'
import WALLETStakingPool from './WALLETStakingPool'
import AaveWethGatewayV2 from './AaveWethGatewayV2'
// Types
import { HumanizerInfoType } from 'hooks/useFetchConstants'

const all = (humanizerInfo:HumanizerInfoType) => ({
  ...UniRouters(humanizerInfo),
  ...AaveLendingPoolV2(humanizerInfo),
  ...AaveWethGatewayV2(humanizerInfo),
  ...ERC20(humanizerInfo),
  ...ERC721(humanizerInfo),
  ...WETH(humanizerInfo),
  ...AmbireIdentity(humanizerInfo),
  ...AmbireFactory(),
  ...YearnTesseractVault(humanizerInfo),
  ...Movr(humanizerInfo),
  ...OpenSea(humanizerInfo),
  ...WALLETSupplyController(),
  ...AmbireBatcher(humanizerInfo),
  ...WALLETStakingPool(humanizerInfo)
})
export default all
