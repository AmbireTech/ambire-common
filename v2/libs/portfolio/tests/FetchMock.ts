import { BodyInit, Response, ResponseInit } from "node-fetch";

class MockResponse extends Response {
    jsonOb: {}

    constructor(jsonOb: {}, body?: BodyInit, init?: ResponseInit) {
        super(body, init)
        this.jsonOb = jsonOb
    }

    json(): Promise<any> {
        return new Promise((resolve, reject) => {
            return resolve(this.jsonOb)
        })
    }
}

export async function fetch(url: string): Promise<Response> {
    let data: {}
    if (url == 'example') {
        data = {
            example: 'test_success'
        }
    }

    return new Promise((resolve, reject) => resolve(new MockResponse(data)))
}