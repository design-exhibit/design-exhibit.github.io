"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertDatabaseResult,
  forwardOrderRequest,
  handleRequest
} = require("../cloudbase/functions/submitOrder/index.js");

const LOCAL_HEADERS = { origin: "http://127.0.0.1:4173" };
const PRODUCTION_HEADERS = { origin: "https://design-exhibit.github.io" };

test("HTTP函数处理预检、错误方法、未知路径和非法来源", async () => {
  const health = await handleRequest({ method: "GET", pathname: "/health", headers: {} });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true, service: "order-api" });

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

test("数据库返回错误对象时不能当作成功", () => {
  assert.throws(
    () => assertDatabaseResult({ code: "DATABASE_PERMISSION_DENIED", message: "permission denied" }, "订单写入"),
    (error) => error.code === "DATABASE_PERMISSION_DENIED" && /订单写入失败/.test(error.message)
  );
  assert.throws(
    () => assertDatabaseResult(null, "订单查询"),
    (error) => error.code === "DATABASE_INVALID_RESULT"
  );
  assert.deepEqual(assertDatabaseResult({ updated: 1 }, "订单写入"), { updated: 1 });
});

test("CloudRun转发订单时保留业务响应并由自身处理CORS", async () => {
  let forwarded;
  const originalDirectCors = process.env.DIRECT_CORS;
  process.env.DIRECT_CORS = "1";
  try {
    const result = await forwardOrderRequest(
      { body: "{\"requestId\":\"test\"}" },
      LOCAL_HEADERS.origin,
      async (url, options) => {
        forwarded = { url, options };
        return new Response(JSON.stringify({ ok: true, orderNo: "DD-TEST" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      },
      "https://test.service.tcloudbase.com/api/orders"
    );

    assert.equal(forwarded.url, "https://test.service.tcloudbase.com/api/orders");
    assert.equal(forwarded.options.headers.Origin, PRODUCTION_HEADERS.origin);
    assert.equal(forwarded.options.body, "{\"requestId\":\"test\"}");
    assert.equal(result.statusCode, 201);
    assert.equal(result.headers["Access-Control-Allow-Origin"], LOCAL_HEADERS.origin);
    assert.deepEqual(JSON.parse(result.body), { ok: true, orderNo: "DD-TEST" });
  } finally {
    if (originalDirectCors === undefined) delete process.env.DIRECT_CORS;
    else process.env.DIRECT_CORS = originalDirectCors;
  }
});
