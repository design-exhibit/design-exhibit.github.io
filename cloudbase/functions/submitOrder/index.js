"use strict";

const http = require("node:http");
const tcb = require("@cloudbase/node-sdk");
const { InputError, createOrderNo, validateCatalog, validateOrderInput } = require("./order-core.cjs");

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || "github-d2gr7dltobfb415cc";
const app = tcb.init({ env: ENV_ID });
const db = app.database();
const ORDERS_COLLECTION = "orders";
const CATALOG_URL = "https://design-exhibit.github.io/data/projects.json";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_BYTES = 64 * 1024;
const CATALOG_CACHE_MS = 60 * 1000;
const PRODUCTION_ORIGIN = "https://design-exhibit.github.io";
const ORDER_UPSTREAM_URL = String(process.env.ORDER_UPSTREAM_URL || "").trim();
const ORDER_PATHS = new Set(["/", "/api/orders"]);
let catalogCache = null;

function headerValue(headers, name) {
  const target = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === target);
  return entry ? String(entry[1]) : "";
}

function isAllowedOrigin(origin) {
  return origin === PRODUCTION_ORIGIN
    || /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(origin);
}

function jsonResponse(statusCode, payload, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
  // CloudBase网关会为本地来源注入CORS，函数重复写入会生成无效的双值响应头。
  if (origin === PRODUCTION_ORIGIN || (process.env.DIRECT_CORS === "1" && isAllowedOrigin(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return { statusCode, headers, body: payload == null ? "" : JSON.stringify(payload) };
}

function parseBody(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw new InputError(400, "提交内容格式不正确或内容过大");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new InputError(400, "提交内容不是有效的JSON");
  }
}

async function fetchCatalog(force = false) {
  if (!force && catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.payload;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(CATALOG_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_CATALOG_BYTES) throw new Error("报价目录过大");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_CATALOG_BYTES) throw new Error("报价目录过大");
    const payload = JSON.parse(text);
    validateCatalog(payload);
    catalogCache = { payload, expiresAt: Date.now() + CATALOG_CACHE_MS };
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function requestIdFrom(input) {
  const value = input && typeof input.requestId === "string" ? input.requestId.trim() : "";
  return /^[0-9a-f-]{36}$/i.test(value) ? value : "";
}

function notificationLine(value) {
  return String(value == null ? "" : value).replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

function databaseError(code, operation, detail = "") {
  const error = new Error(`${operation}失败${detail ? `：${detail}` : ""}`);
  error.code = notificationLine(code) || "DATABASE_UNKNOWN_ERROR";
  return error;
}

function assertDatabaseResult(result, operation) {
  if (!result || typeof result !== "object") {
    throw databaseError("DATABASE_INVALID_RESULT", operation, "数据库未返回有效结果");
  }
  if (result.code) {
    throw databaseError(result.code, operation, notificationLine(result.message));
  }
  return result;
}

async function forwardOrderRequest(request, origin, fetchImpl = fetch, upstreamUrl = ORDER_UPSTREAM_URL) {
  if (!/^https:\/\/[a-z0-9-]+\.service\.tcloudbase\.com\/api\/orders$/i.test(upstreamUrl)) {
    throw new Error("订单上游地址无效");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Origin: PRODUCTION_ORIGIN
      },
      body: request.body,
      signal: controller.signal
    });
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_UPSTREAM_BYTES) throw new Error("订单上游响应过大");
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > MAX_UPSTREAM_BYTES) {
      throw new Error("订单上游响应过大");
    }
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error("订单上游响应格式无效");
    }
    return jsonResponse(response.status, payload, origin);
  } finally {
    clearTimeout(timer);
  }
}

async function findExistingOrder(requestId) {
  if (!requestId) return null;
  try {
    const result = assertDatabaseResult(
      await db.collection(ORDERS_COLLECTION).doc(requestId).get(),
      "订单查询"
    );
    return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
  } catch (error) {
    const detail = `${error && error.code || ""} ${error && error.message || ""}`;
    if (/not.?found|not exist|collection.*exist|-502005/i.test(detail)) return null;
    throw error;
  }
}

function notificationText(order) {
  const lines = order.items.map((item) => (
    item.kind === "fixed"
      ? `${notificationLine(item.label)}：¥${(item.amountFen / 100).toFixed(2)}`
      : `${notificationLine(item.label)}：${notificationLine(item.consultText)}`
  ));
  return [
    `新需求 ${notificationLine(order.orderNo)}`,
    `项目：${notificationLine(order.project.code)} ${notificationLine(order.project.title)}`,
    `方案：${lines.join("；")}`,
    `客户：${notificationLine(order.customer.name)}`,
    `手机：${notificationLine(order.customer.phone) || "未填写"}`,
    `微信：${notificationLine(order.customer.wechat) || "未填写"}`,
    `需要邮寄：${order.shipping.required ? "是" : "否"}`
  ].join("\n").slice(0, 1800);
}

async function notifyOwner(order) {
  const webhook = String(process.env.WECOM_WEBHOOK_URL || "").trim();
  if (!webhook) return "disabled";
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[0-9a-f-]+$/i.test(webhook)) {
    throw new Error("企业微信Webhook地址无效");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: notificationText(order) } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`企业微信通知HTTP ${response.status}`);
    const result = await response.json();
    if (result.errcode !== 0) throw new Error(`企业微信通知错误 ${result.errcode}`);
    return "sent";
  } finally {
    clearTimeout(timer);
  }
}

async function handleRequest(request = {}) {
  const method = String(request.method || "POST").toUpperCase();
  const pathname = request.pathname || "/";

  if (method === "GET" && pathname === "/health") {
    return jsonResponse(200, { ok: true, service: "order-api" });
  }

  const origin = headerValue(request.headers, "origin");
  if (!isAllowedOrigin(origin)) return jsonResponse(403, { ok: false, message: "来源不允许" });

  if (!ORDER_PATHS.has(pathname)) {
    return jsonResponse(404, { ok: false, message: "接口不存在" }, origin);
  }

  if (method === "OPTIONS") return jsonResponse(204, null, origin);
  if (method !== "POST") return jsonResponse(405, { ok: false, message: "仅支持POST请求" }, origin);
  if (!headerValue(request.headers, "content-type").toLowerCase().includes("application/json")) {
    return jsonResponse(415, { ok: false, message: "请使用JSON格式提交" }, origin);
  }

  try {
    if (ORDER_UPSTREAM_URL) return await forwardOrderRequest(request, origin);

    const input = parseBody(request.body);
    const requestId = requestIdFrom(input);
    const existing = await findExistingOrder(requestId);
    if (existing && existing.orderNo) {
      return jsonResponse(200, {
        ok: true,
        orderNo: existing.orderNo,
        knownTotalFen: existing.knownTotalFen || 0,
        consultationCount: existing.consultationCount || 0
      }, origin);
    }

    let catalog;
    try {
      catalog = await fetchCatalog();
    } catch {
      throw new InputError(503, "报价数据暂时不可用，请稍后重试");
    }

    let orderDraft;
    try {
      orderDraft = validateOrderInput(input, catalog);
    } catch (error) {
      if (!(error instanceof InputError) || error.statusCode !== 409) throw error;
      try {
        catalog = await fetchCatalog(true);
      } catch {
        throw new InputError(503, "报价数据暂时不可用，请稍后重试");
      }
      orderDraft = validateOrderInput(input, catalog);
    }

    const now = new Date();
    const order = {
      schemaVersion: 1,
      orderNo: createOrderNo(orderDraft.requestId, now),
      status: "new",
      ...orderDraft,
      source: "github-pages",
      notifyStatus: process.env.WECOM_WEBHOOK_URL ? "pending" : "disabled",
      createdAt: now,
      updatedAt: now
    };
    const orderReference = db.collection(ORDERS_COLLECTION).doc(order.requestId);
    const writeResult = assertDatabaseResult(await orderReference.set(order), "订单写入");
    if (Number(writeResult.updated || 0) < 1 && !writeResult.upsertedId) {
      throw databaseError("DATABASE_WRITE_NOT_CONFIRMED", "订单写入", "数据库未确认写入");
    }

    if (order.notifyStatus === "pending") {
      try {
        order.notifyStatus = await notifyOwner(order);
      } catch (error) {
        order.notifyStatus = "failed";
        console.error("订单通知失败", { orderNo: order.orderNo, message: String(error && error.message) });
      }
      try {
        assertDatabaseResult(
          await orderReference.update({ notifyStatus: order.notifyStatus, updatedAt: new Date() }),
          "通知状态更新"
        );
      } catch (error) {
        console.error("通知状态更新失败", { orderNo: order.orderNo, message: String(error && error.message) });
      }
    }

    return jsonResponse(201, {
      ok: true,
      orderNo: order.orderNo,
      knownTotalFen: order.knownTotalFen,
      consultationCount: order.consultationCount
    }, origin);
  } catch (error) {
    const statusCode = error instanceof InputError ? error.statusCode : 500;
    const message = error instanceof InputError ? error.message : "订单提交失败，请稍后重试";
    console.error("订单提交失败", { name: error && error.name, message: String(error && error.message) });
    const payload = { ok: false, message };
    if (statusCode >= 500 && /^[A-Z][A-Z0-9_-]{2,79}$/.test(String(error && error.code || ""))) {
      payload.errorCode = String(error.code);
    }
    return jsonResponse(statusCode, payload, origin);
  }
}

function writeNodeResponse(response, result) {
  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
}

function startHttpServer() {
  const server = http.createServer((request, response) => {
    const chunks = [];
    let receivedBytes = 0;
    let finished = false;

    request.on("data", (chunk) => {
      if (finished) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        finished = true;
        writeNodeResponse(response, jsonResponse(413, { ok: false, message: "提交内容过大" }, request.headers.origin));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", async () => {
      if (finished) return;
      finished = true;
      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      const result = await handleRequest({
        method: request.method,
        pathname,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      writeNodeResponse(response, result);
    });

    request.on("error", () => {
      if (finished) return;
      finished = true;
      writeNodeResponse(response, jsonResponse(400, { ok: false, message: "请求读取失败" }, request.headers.origin));
    });
  });

  const port = Number.parseInt(process.env.PORT || "", 10) || 9000;
  server.listen(port, "0.0.0.0");
}

if (require.main === module) startHttpServer();

module.exports = { assertDatabaseResult, forwardOrderRequest, handleRequest, startHttpServer };
