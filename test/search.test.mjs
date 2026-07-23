import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  buildOrderPayload,
  buildRequirementText,
  isValidPhone,
  priceLabelsToUncheck,
  priceSelectionSummary,
  projectImageEntries,
  searchProjects,
  submitOrder
} from "../site/app.js";

test("搜索支持精准编号和多关键词", () => {
  const projects = [
    {
      id: "A001",
      code: "A001",
      title: "STM32温湿度监测",
      mcuFamily: "STM32",
      mcuModel: "",
      usages: ["环境监测"],
      modules: ["DHT11", "OLED"],
      description: "仿真上不了云，实物可以",
      keywords: [],
      prices: [{ label: "任务书", price: 20 }],
      sort: 1
    },
    {
      id: "B002",
      code: "B002",
      title: "51单片机超声波测距",
      mcuFamily: "51单片机",
      mcuModel: "",
      usages: ["距离测量"],
      modules: ["HC-SR04"],
      keywords: [],
      prices: [],
      sort: 2
    }
  ];

  const exact = searchProjects(projects, "A001");
  assert.equal(exact[0].exact, true);
  assert.equal(exact[0].project.id, "A001");
  assert.equal(searchProjects(projects, "STM32 DHT11").length, 1);
  assert.equal(searchProjects(projects, "超声波 距离").length, 1);
  assert.equal(searchProjects(projects, "任务书").length, 1);
  assert.equal(searchProjects(projects, "上不了云").length, 0);
});

test("生成数据不包含内部资料字段和链接", async () => {
  const payload = JSON.parse(await fs.readFile("site/data/projects.json", "utf8"));
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("下载链接"), false);
  assert.equal(serialized.includes("资料介绍链接"), false);
  assert.equal(serialized.includes("资料主要内容"), false);
  assert.equal(serialized.includes("DISPIMG"), false);
  assert.equal(/https?:\/\//.test(serialized), false);
  assert.equal(new Set(payload.projects.map((project) => project.id)).size, payload.projects.length);
  assert.ok(payload.projects.length > 0);
  assert.equal(payload.meta.count, payload.projects.length);
});

test("项目图片只返回已填写的仿真图和实物图", () => {
  const both = projectImageEntries({
    simulationImage: { src: "./simulation.jpg" },
    hardwareImage: { src: "./hardware.jpg" }
  });
  assert.deepEqual(both.map(({ label }) => label), ["仿真图片", "实物图片"]);
  assert.equal(projectImageEntries({ hardwareImage: { src: "./hardware.jpg" } }).length, 1);
  assert.deepEqual(projectImageEntries({}), []);
});

test("价格方案支持自由组合并计算总价", () => {
  assert.equal(priceSelectionSummary(), "已选 0 项，合计 ¥0");
  assert.equal(priceSelectionSummary([{ price: 200 }, { price: 100 }]), "已选 2 项，合计 ¥300");
  assert.equal(priceSelectionSummary([{ price: 200 }, { price: "面议" }]), "已选 2 项，已知合计 ¥200，另有 1 项需咨询");
  assert.equal(priceSelectionSummary([{ price: "咨询" }]), "已选 1 项，价格需咨询");
});

test("全套文档服务与文档单项不会重复选择", () => {
  assert.deepEqual(
    priceLabelsToUncheck("成果书+任务书+PPT+答辩模板+过AI+过查重", true),
    ["成果书", "任务书", "PPT送答辩模板", "论文"]
  );
  assert.deepEqual(priceLabelsToUncheck("任务书", true), ["成果书+任务书+PPT+答辩模板+过AI+过查重"]);
  assert.deepEqual(priceLabelsToUncheck("仿真+仿真代码", true), []);
});

test("确认后生成可复制的项目需求", () => {
  const text = buildRequirementText(
    { code: "Y001", title: "语音识别柔光台灯" },
    [{ label: "仿真+仿真代码", price: 200 }, { label: "原理图+PCB设计", price: 100 }],
    " 需要加急交付 "
  );
  assert.match(text, /项目名称：语音识别柔光台灯/);
  assert.match(text, /项目编号：Y001/);
  assert.match(text, /1\. 仿真\+仿真代码：¥200/);
  assert.match(text, /2\. 原理图\+PCB设计：¥100/);
  assert.match(text, /报价结果：已选 2 项，合计 ¥300/);
  assert.match(text, /备注：需要加急交付/);
});

test("订单 payload 严格匹配后端字段且未勾选邮寄时不带地址", () => {
  const payload = buildOrderPayload({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    catalogGeneratedAt: "2026-07-20T00:00:00Z",
    project: { id: "S系列::S001", code: "S001", title: "测试项目" },
    selectedPrices: [{ label: "仿真+仿真代码", price: 100 }],
    note: " 需要加急 ",
    customer: { name: " 张三 ", phone: " 13800138000 ", wechat: " wx-test " },
    shipping: { required: false, address: "不应提交的地址" },
    privacyAccepted: true
  });

  assert.deepEqual(payload, {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    catalogGeneratedAt: "2026-07-20T00:00:00Z",
    projectId: "S系列::S001",
    selectedLabels: ["仿真+仿真代码"],
    note: "需要加急",
    customer: { name: "张三", phone: "13800138000", wechat: "wx-test" },
    shipping: { required: false, address: "" },
    privacyAccepted: true,
    website: ""
  });
});

test("客户信息只通过 POST body 提交，不进入复制文本、URL 或本地存储", async () => {
  const payload = buildOrderPayload({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    catalogGeneratedAt: "2026-07-20T00:00:00Z",
    project: { id: "S系列::S001", code: "S001", title: "测试项目" },
    selectedPrices: [{ label: "任务书", price: 20 }],
    customer: { name: "李四", phone: "13900139000", wechat: "private-wx" },
    shipping: { required: true, address: "上海市测试路1号" },
    privacyAccepted: true
  });
  let request;
  const result = await submitOrder(payload, async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true, orderNo: "DD20260720-123E4567" }) };
  });

  assert.equal(request.url, "https://order-api-284527-6-1455865098.sh.run.tcloudbase.com/api/orders");
  assert.equal(request.url.includes("李四"), false);
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), payload);
  assert.equal(buildRequirementText(
    { code: "S001", title: "测试项目" },
    [{ label: "任务书", price: 20 }]
  ).includes("李四"), false);
  assert.equal(result.orderNo, "DD20260720-123E4567");
  const source = await fs.readFile("site/app.js", "utf8");
  assert.equal(source.includes("localStorage"), false);
});

test("订单接口错误会保留服务端提示供用户重试", async () => {
  await assert.rejects(
    () => submitOrder({}, async () => ({
      ok: false,
      json: async () => ({ ok: false, message: "报价数据已经更新，请刷新页面后重新选择" })
    })),
    /报价数据已经更新/
  );
});

test("手机号必须包含足够数字，订单请求超时后可重试", async () => {
  assert.equal(isValidPhone("138 0013 8000"), true);
  assert.equal(isValidPhone("......"), false);
  await assert.rejects(
    () => submitOrder({}, (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }), 5),
    /提交超时/
  );
});
