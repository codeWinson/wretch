import * as nodeFetch from "node-fetch"
import * as FormData from "form-data"
import * as AbortController from "abortcontroller"
import * as fs from "fs"
import { URLSearchParams } from "url"
import * as path from "path"
import wretch from "../src"
import { mix } from "../src/mix"

const { performance, PerformanceObserver } = require("perf_hooks")
// tslint:disable-next-line:no-empty
performance.clearResourceTimings = () => {}
const mockServer = require("./mock")

const _PORT = 9876
const _URL = `http://localhost:${_PORT}`

const allRoutes = (obj, type, action, opts?) => Promise.all([
    obj.get(opts)[type](_ => _).then(action),
    obj.put(opts)[type](action),
    obj.patch(opts)[type](action),
    obj.post(opts)[type](action),
    obj.delete(opts)[type](action),
])

const fetchPolyfill = (timeout = null) =>
    function(url, opts) {
        performance.mark(url + " - begin")
        return nodeFetch(url, opts).then(_ => {
            performance.mark(url + " - end")
            const measure = () => performance.measure(_.url, url + " - begin", url + " - end")
            if(timeout)
                setTimeout(measure, timeout)
            else
                measure()
            return _
        })
    }

const duckImage = fs.readFileSync(path.resolve(__dirname, "assets", "duck.jpg"))

describe("Wretch", function() {

    beforeAll(function() {
        mockServer.launch(_PORT)
    })

    afterAll(function() {
        mockServer.stop()
    })

    it("should set and use non global polyfills", async function() {
        global["FormData"] = null

        expect(() => wretch("...").query({ a: 1, b: 2 })).toThrow("URLSearchParams is not defined")
        expect(() => wretch("...").formData({ a: 1, b: 2 })).toThrow("FormData is not defined")
        expect(() => wretch("...").get("...")).toThrow("fetch is not defined")

        wretch().polyfills({
            fetch: fetchPolyfill(),
            FormData,
            URLSearchParams
        })

        await wretch(`${_URL}/text`).get().perfs(_ => fail("should never be called")).res()

        wretch(null, null).polyfills({
            fetch: fetchPolyfill(),
            FormData,
            URLSearchParams,
            performance,
            PerformanceObserver,
            AbortController
        })
    })

    it("should perform crud requests and parse a text response", async function() {
        const init = wretch(`${_URL}/text`)
        const test = _ => expect(_).toBe("A text string")
        await allRoutes(init, "text", test)
        await allRoutes(init, "text", test, {})
    })

    it("should perform crud requests and parse a json response", async function() {
        const test = _ => expect(_).toEqual({ a: "json", object: "which", is: "stringified" })
        const init = wretch(`${_URL}/json`)
        await allRoutes(init, "json", test)
        await allRoutes(init, "json", test, {})
    })

    it("should perform crud requests and parse a blob response", async function() {
        const test = _ => expect(_.size).toBe(duckImage.length)
        const init = wretch(`${_URL}/blob`)
        await allRoutes(init, "blob", test)
        await allRoutes(init, "blob", test, {})
    })

    it("should perform crud requests and parse an arrayBuffer response", async function() {
        const test = arrayBuffer => {
            const buffer = new Buffer(arrayBuffer.byteLength)
            const view = new Uint8Array(arrayBuffer)
            for (let i = 0; i < buffer.length; ++i) {
                buffer[i] = view[i]
            }
            expect(buffer.equals(Buffer.from([ 0x00, 0x01, 0x02, 0x03 ]))).toBe(true)
        }
        const init = wretch(`${_URL}/arrayBuffer`)
        await allRoutes(init, "arrayBuffer", test)
        await allRoutes(init, "arrayBuffer", test, {})
    })

    it("should perform a plain text round trip", async function() {
        const text = "hello, server !"
        const roundTrip = await wretch(`${_URL}/text/roundTrip`).content("text/plain").body(text).post().text()
        expect(roundTrip).toBe(text)
    })

    it("should perform a json round trip", async function() {
        const jsonObject = { a: 1, b: 2, c: 3 }
        const roundTrip = await wretch(`${_URL}/json/roundTrip`).json(jsonObject).post().json()
        expect(roundTrip).toEqual(jsonObject)
    })

    it("should perform an url encoded form data round trip", async function() {
        const reference = "a=1&b=2&%20c=%203&d=%7B%22a%22%3A1%7D"
        const jsonObject = { "a": 1, "b": 2, " c": " 3", "d": { a: 1 } }
        let roundTrip = await wretch(`${_URL}/urlencoded/roundTrip`).formUrl(reference).post().text()
        expect(roundTrip).toBe(reference)
        roundTrip = await wretch(`${_URL}/urlencoded/roundTrip`).formUrl(jsonObject).post().text()
        expect(roundTrip).toEqual(reference)
    })

    it("should send a FormData object", async function() {
        const form = {
            hello: "world",
            duck: "Muscovy"
        }
        const decoded = await wretch(`${_URL}/formData/decode`).formData(form).post().json()
        expect(decoded).toEqual({
            hello: "world",
            duck: "Muscovy"
        })
        // form-data package has an implementation which differs from the browser standard.
        const f = { arr: [ 1, 2, 3 ]}
        const d = wretch(`${_URL}/formData/decode`).formData(f).post().json()
        // expect(d).toEqual({
        //     "arr[]": [1, 2, 3]
        // })
    })

    it("should perform OPTIONS and HEAD requests", async function() {
        const optsRes = await wretch(_URL + "/options").opts().res()
        const optsRes2 = await wretch(_URL + "/options").opts({}).res()
        expect(optsRes.headers.get("Allow")).toBe("OPTIONS")
        expect(optsRes2.headers.get("Allow")).toBe("OPTIONS")
        const headRes = await wretch(_URL + "/json").head().res()
        const headRes2 = await wretch(_URL + "/json").head({}).res()
        expect(headRes.headers.get("content-type")).toBe("application/json")
        expect(headRes2.headers.get("content-type")).toBe("application/json")
    })

    it("should catch common error codes", async function() {
        const w = wretch(_URL + "/")

        let check = 0
        await w.url("400").get().badRequest(_ => {
            expect(_.message).toBe("error code : 400")
            check++
        }).text(_ => expect(_).toBeNull())
        await w.url("401").get().unauthorized(_ => {
            expect(_.message).toBe("error code : 401")
            check++
        }).text(_ => expect(_).toBeNull())
        await w.url("403").get().forbidden(_ => {
            expect(_.message).toBe("error code : 403")
            check++
        }).text(_ => expect(_).toBeNull())
        await w.url("404").get().notFound(_ => {
            expect(_.message).toBe("error code : 404")
            check++
        }).text(_ => expect(_).toBeNull())
        await w.url("408").get().timeout(_ => {
            expect(_.message).toBe("error code : 408")
            check++
        }).text(_ => expect(_).toBeNull())
        await w.url("500").get().internalError(_ => {
            expect(_.message).toBe("error code : 500")
            check++
        }).text(_ => expect(_).toBeNull())
        expect(check).toBe(6)
    })

    it("should catch other error codes", async function() {
        let check = 0
        await wretch(`${_URL}/444`)
            .get()
            .notFound(_ => check++)
            .error(444, _ => check++)
            .unauthorized(_ => check++)
            .res(_ => expect(_).toBe(undefined))
        expect(check).toBe(1)
    })

    it("should set and catch errors with global catchers", async function() {
        let check = 0
        const w = wretch(_URL + "/")
            .catcher(404, err => check++)
            .catcher(500, err => check++)
            .catcher(400, err => check++)
            .catcher(401, err => check--)
            .catcher("FetchError", err => check++)

        await w.url("text").get().res(_ => check++)
        await w.url("text").get().json(_ => check--)
        await w.url("/400").get().res(_ => check--)
        await w.url("/401").get().unauthorized(_ => check++).res(_ => check--)
        await w.url("/404").get().res(_ => check--)
        await w.url("/408").get().timeout(_ => check++).res(_ => check--)
        await w.url("/418").get().res(_ => check--).catch(_ => "muted")
        await w.url("/500").get().res(_ => check--)

        expect(check).toBe(7)
    })

    it("should set default fetch options", async function() {
        let rejected = await new Promise(res => wretch(`${_URL}/customHeaders`).get().badRequest(_ => {
            res(true)
        }).res(result => res(!result)))
        expect(rejected).toBeTruthy()
        wretch().defaults({
            headers: { "X-Custom-Header": "Anything" }
        })
        rejected = await new Promise(res => wretch(`${_URL}/customHeaders`).get().badRequest(_ => {
            res(true)
        }).res(result => res(!result)))
        expect(rejected).toBeTruthy()
        wretch().defaults({
            headers: { "X-Custom-Header-2": "Anything" }
        }, true)
        rejected = await new Promise(res => wretch(`${_URL}/customHeaders`).get().badRequest(_ => {
            res(true)
        }).res(result => res(!result)))
        wretch().defaults("not an object", true)
        expect(rejected).toBeTruthy()
        const accepted = await new Promise(res => wretch(`${_URL}/customHeaders`)
            .options({ headers: { "X-Custom-Header-3" : "Anything" } }, false)
            .options({ headers: { "X-Custom-Header-4" : "Anything" } })
            .get()
            .badRequest(_ => { res(false) })
            .res(result => res(!!result)))
        expect(accepted).toBeTruthy()
    })

    it("should allow url, query parameters & options modifications and return a fresh new Wretcher object containing the change", async function() {
        const obj1 = wretch("...")
        const obj2 = obj1.url(_URL, true)
        expect(obj1._url).toBe("...")
        expect(obj2._url).toBe(_URL)
        const obj3 = obj1.options({ headers: { "X-test": "test" }})
        expect(obj3._options).toEqual({ headers: { "X-test": "test" }})
        expect(obj1._options).toEqual({})
        const obj4 = obj2.query({a: "1!", b: "2"})
        expect(obj4._url).toBe(`${_URL}?a=1%21&b=2`)
        expect(obj2._url).toBe(_URL)
        const obj5 = obj4.query({c: 6, d: [7, 8]})
        expect(obj4._url).toBe(`${_URL}?a=1%21&b=2`)
        expect(obj5._url).toBe(`${_URL}?c=6&d=7&d=8`)
    })

    it("should set the Accept header", async function() {
        expect(await wretch(`${_URL}/accept`).get().text()).toBe("text")
        expect(await wretch(`${_URL}/accept`).accept("application/json").get().json()).toEqual({ json: "ok" })
    })

    it("should set the Authorization header", async function() {
        try { await wretch(_URL + "/basicauth")
            .get()
            .res(_ => fail("Authenticated route should not respond without credentials."))
         } catch(e) {
             expect(e.status).toBe(401)
         }

        const res = await wretch(_URL + "/basicauth")
            .auth("Basic d3JldGNoOnJvY2tz")
            .get()
            .text()

        expect(res).toBe("ok")
    })

    it("should change the parsing used in the default error handler", async function() {
        wretch().errorType("json")
        await wretch(`${_URL}/json500`)
            .get()
            .internalError(error => { expect(error.json).toEqual({ error: 500, message: "ok" }) })
            .res(_ => fail("I should never be called because an error was thrown"))
            .then(_ => expect(_).toBe(undefined))
        // Change back
        wretch().errorType("text")
    })

    it("should retrieve performance timings associated with a fetch request", function(done) {
        // Test empty perfs()
        wretch(`${_URL}/text`).get().perfs().res(_ => expect(_.ok).toBeTruthy()).then(
            // Racing condition : observer triggered before response
            wretch(`${_URL}/bla`).get().perfs(_ => {
                expect(typeof _.startTime).toBe("number")

                // Racing condition : response triggered before observer
                wretch().polyfills({
                    fetch: fetchPolyfill(1000)
                })

                wretch(`${_URL}/fakeurl`).get().perfs(_ => {
                    expect(typeof _.startTime).toBe("number")
                    done()
                }).res().catch(() => "ignore")
            }).res().catch(_ => "ignore")
        )
    })

    it("should abort a request", function(done) {
        // Waiting for real nodejs polyfills ...
        const controller = new AbortController()
        wretch(`${_URL}/longResult`)
            .signal(controller)
            .get()
            .text(_ => 1)
        controller.abort()

        const [c, w] = wretch(`${_URL}/longResult`).get().controller()
        w.text(_ => 1)
        c.abort()

        wretch(`${_URL}/longResult`)
            .get()
            .setTimeout(500)
            // tslint:disable-next-line:no-console
            .onAbort(err => console.log(err))

        setTimeout(done, 1000)
    })

    it("should program resolvers", async function() {
        let check = 0
        const w = wretch()
            .url(_URL)
            .resolve(resolver => resolver
                .unauthorized(_ => check--))
            .resolve(resolver => resolver
                .unauthorized(_ => check++), true)
            .resolve(resolver => resolver
                .perfs(_ => check++)
                .json(_ => { check++; return _ }))
        const result = await w.url("/json").get()
        expect(result).toEqual({ a: "json", object: "which", is: "stringified" })
        expect(check).toBe(2)
        await w.url("/401").get()
        expect(check).toBe(4)
    })
})

describe("Mix", function() {
    it("should mix two objects", function() {
        const obj1 = { a: 1, b: 2, c: [ 3, 4 ] }
        const obj2proto = { z: 1 }
        const obj2 = Object.create(obj2proto)
        Object.assign(obj2, { a: 0, d: 5, e: [6], c: [ 5, 6 ] })
        expect(mix(obj1, obj2, false)).toEqual({ a: 0, b: 2, c: [ 5, 6 ], d: 5, e: [6] })
        expect(mix(obj1, obj2, true)).toEqual({ a: 0, b: 2, c: [ 3, 4, 5, 6 ], d: 5, e: [6] })
    })
})
