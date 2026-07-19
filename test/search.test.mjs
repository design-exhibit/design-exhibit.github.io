import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { buildRequirementText, priceSelectionSummary, searchProjects } from "../site/app.js";

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
      keywords: [],
      prices: [{ label: "仿真+仿真代码", price: 200 }],
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
});

test("生成数据不包含内部资料字段和链接", async () => {
  const payload = JSON.parse(await fs.readFile("site/data/projects.json", "utf8"));
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("下载链接"), false);
  assert.equal(serialized.includes("资料介绍链接"), false);
  assert.equal(serialized.includes("资料主要内容"), false);
  assert.equal(/https?:\/\//.test(serialized), false);
  assert.equal(new Set(payload.projects.map((project) => project.id)).size, payload.projects.length);
  assert.ok(payload.projects.length > 300);
});

test("价格方案支持自由组合并计算总价", () => {
  assert.equal(priceSelectionSummary(), "已选 0 项，合计 ¥0");
  assert.equal(priceSelectionSummary([{ price: 200 }, { price: 100 }]), "已选 2 项，合计 ¥300");
  assert.equal(priceSelectionSummary([{ price: 200 }, { price: "面议" }]), "已选 2 项，已知合计 ¥200，另有 1 项需咨询");
  assert.equal(priceSelectionSummary([{ price: "咨询" }]), "已选 1 项，价格需咨询");
});

test("确认后生成可复制的项目需求", () => {
  const text = buildRequirementText(
    { code: "Y001", title: "语音识别柔光台灯" },
    [{ label: "仿真+仿真代码", price: 200 }, { label: "原理图+PCB设计", price: 100 }]
  );
  assert.match(text, /项目名称：语音识别柔光台灯/);
  assert.match(text, /项目编号：Y001/);
  assert.match(text, /1\. 仿真\+仿真代码：¥200/);
  assert.match(text, /2\. 原理图\+PCB设计：¥100/);
  assert.match(text, /报价结果：已选 2 项，合计 ¥300/);
});
