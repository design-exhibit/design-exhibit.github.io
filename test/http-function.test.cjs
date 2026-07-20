"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { handleRequest } = require("../cloudbase/functions/submitOrder/index.js");

const LOCAL_HEADERS = { origin: "http://127.0.0.1:4173" };
const PRODUCTION_HEADERS = { origin: "https://design-exhibit.github.io" };

test("HTTP函数处理预检、错误方法、未知路径和非法来源", async () => {
  const options = await handleRequest({ method: "OPTIONS", pathname: "/", headers: LOCAL_HEADERS });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers["Access-Control-Allow-Origin"], undefined);

  const productionOptions = await handleRequest({ method: "OPTIONS", pathname: "/", headers: PRODUCTION_HEADERS });
  assert.equal(productionOptions.statusCode, 204);
  assert.equal(productionOptions.headers["Access-Control-Allow-Origin"], PRODUCTION_HEADERS.origin);

  const get = await handleRequest({ method: "GET", pathname: "/", headers: LOCAL_HEADERS });
  assert.equal(get.statusCode, 405);

  const missing = await handleRequest({ method: "POST", pathname: "/missing", headers: LOCAL_HEADERS });
  assert.equal(missing.statusCode, 404);

  const forbidden = await handleRequest({
    method: "POST",
    pathname: "/",
    headers: { origin: "https://example.invalid", "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(forbidden.statusCode, 403);

  const missingOrigin = await handleRequest({
    method: "POST",
    pathname: "/",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(missingOrigin.statusCode, 403);
});
