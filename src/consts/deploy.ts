// NOTE<Bobby>: This is an address I deployed with my PK and nonce.
// Currently, it's live only on Polygon.
// The address needs to be the same on each chain and deployed with nonce 0.
// Once that is done, please change the PROXY_AMBIRE_ACCOUNT to the correct
// one and delete this NOTE.
// Currently, we use this proxy for tests.
export const PROXY_AMBIRE_ACCOUNT = '0xfF69afDE895B381eE71e17C60350aE4c70b16a92'

// These's a decent chance the factory address is the permanent one.
export const AMBIRE_ACCOUNT_FACTORY = '0xA3A22Bf212C03ce55eE7C3845D4c177a6fEC418B'

// deployAndExecute returns the address here. Only on polygon
export const AMBIRE_ACCOUNT_FACTORY_ERC_4337 = '0x639ab10C2de76fF2C112f20c5c3D496e9B6a8356'

// only on polygon, use only for tests
export const PROXY_AMBIRE_4337_ACCOUNT = '0xd590a2aBA89a590b15De795DE559e7166aC293eA'

// official entryPoint
export const ERC_4337_ENTRYPOINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'

// entry point privilege
export const ENTRY_POINT_MARKER =
  '0x0000000000000000000000000000000000000000000000000000000000007171'

export const MAX_UINT256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n
