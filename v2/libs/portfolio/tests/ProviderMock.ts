import { FetchRequest, JsonRpcApiProviderOptions, JsonRpcProvider, Networkish, TransactionRequest } from "ethers";
import { BodyInit, Response, ResponseInit } from "node-fetch";

class ProviderMock extends JsonRpcProvider {

    constructor(url?: string | FetchRequest, network?: Networkish, options?: JsonRpcApiProviderOptions) {
        super(url, network, options)
    }

    // return whatever you want
    async send(method: string, params: Array<any> | Record<string, any>): Promise<any> {
        return new Promise((resolve, reject) => resolve(1))
    }

    // return whatever you want
    async call(_tx: TransactionRequest): Promise<string> {
        return new Promise((resolve, reject) => resolve('1'))
    }
}