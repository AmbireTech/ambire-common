import { BodyInit, Response, ResponseInit } from "node-fetch";

class MockResponse extends Response {
    jsonOb: {}

    constructor(jsonOb: {}, body?: BodyInit, init?: ResponseInit) {
        super(body, init)
        this.jsonOb = jsonOb
    }

    json(): Promise<any> {
        return new Promise((resolve, reject) => resolve(this.jsonOb))
    }
}

// whatever json you pass to the fetch method, that is what
// you will get after calling the json() method
export async function fetch(data: {}): Promise<Response> {
    return new Promise((resolve, reject) => resolve(new MockResponse(data)))
}