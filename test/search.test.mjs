import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { searchProjects } from "../site/app.js";

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
