// NOTE<Bobby>: This is an address I deployed with my PK and nonce.
// Currently, it's live only on Polygon.
// The address needs to be the same on each chain and deployed with nonce 0.
// Once that is done, please change the PROXY_AMBIRE_ACCOUNT to the correct
// one and delete this NOTE.
// Currently, we use this proxy for tests.
export const PROXY_AMBIRE_ACCOUNT = '0xfF69afDE895B381eE71e17C60350aE4c70b16a92'

// These's a decent chance the factory address is the permanent one.
export const AMBIRE_ACCOUNT_FACTORY = '0xA3A22Bf212C03ce55eE7C3845D4c177a6fEC418B'

// this is a proxy ambire account with a validateUserOp method.
// use it for testing purposes only
export const PROXY_VALIDATE_OP = '0x499A2f72393958cc4b78A7EAfA7DA1B954bbbAFF'
export const FACTORY_VALIDATE_OP = '0x531Fd36211fc637B40A8dD1d43b493EB6592163E'
