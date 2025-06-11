import { ChainlistNetwork, Network, RelayerNetwork } from '../interfaces/network';
declare const checkIsRpcUrlWorking: (rpcUrl: string) => Promise<boolean>;
declare const rollProviderUrlsAndFindWorking: (rpcUrls: string[], index: number) => Promise<string | null>;
declare const convertToAmbireNetworkFormat: (network: ChainlistNetwork) => Promise<Network>;
/**
 * Maps the configuration of a Relayer network to the Ambire network format.
 * Needed, because the structures does NOT fully match, some values need to be
 * transformed or parsed (number to bigint). And finally, because there are
 * default values that need to be set for the so called "predefined" networks.
 */
export declare const mapRelayerNetworkConfigToAmbireNetwork: (chainId: bigint, relayerNetwork: RelayerNetwork) => Network & {
    predefinedConfigVersion: number;
    disabledByDefault?: boolean;
};
export { checkIsRpcUrlWorking, convertToAmbireNetworkFormat, rollProviderUrlsAndFindWorking };
//# sourceMappingURL=networks.d.ts.map