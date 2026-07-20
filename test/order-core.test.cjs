const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InputError,
  createOrderNo,
  validateCatalog,
  validateOrderInput
} = require("../cloudbase/functions/submitOrder/order-core.cjs");

const catalog = {
  meta: { generatedAt: "2026-07-20T00:00:00Z" },
  projects: [
    {
      id: "S系列::S001",
      code: "S001",
      title: "测试项目",
      prices: [
        { label: "仿真+仿真代码", price: 100 },
        { label: "任务书", price: 10.5 },
        { label: "成果书+任务书+PPT+答辩模板+过AI+过查重", price: 400 },
        { label: "咨询方案", price: "面议" }
      ]
    },
    { id: "其他系列::S001", code: "S001", title: "同编号项目", prices: [{ label: "硬件", price: 300 }] }
  ]
};

function validInput() {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    catalogGeneratedAt: catalog.meta.generatedAt,
    projectId: "S系列::S001",
    selectedLabels: ["仿真+仿真代码", "任务书", "咨询方案"],
    note: "需要加急",
    customer: { name: "张三", phone: "138 0013 8000", wechat: "" },
    shipping: { required: true, address: "上海市测试路1号" },
    privacyAccepted: true,
    website: ""
  };
}

test("服务端按复合项目ID和目录价格重新计算", () => {
  const order = validateOrderInput({ ...validInput(), total: 1 }, catalog);
  assert.equal(order.project.id, "S系列::S001");
  assert.equal(order.knownTotalFen, 11050);
  assert.equal(order.consultationCount, 1);
  assert.deepEqual(order.items[1], { label: "任务书", kind: "fixed", amountFen: 1050 });
});

test("报价版本变化时要求用户刷新", () => {
  assert.throws(
    () => validateOrderInput({ ...validInput(), catalogGeneratedAt: "old" }, catalog),
    (error) => error instanceof InputError && error.statusCode === 409
  );
});

test("拒绝未知、重复以及互斥的报价标签", () => {
  assert.throws(() => validateOrderInput({ ...validInput(), selectedLabels: ["不存在"] }, catalog), /已失效/);
  assert.throws(() => validateOrderInput({ ...validInput(), selectedLabels: ["任务书", "任务书"] }, catalog), /不能重复/);
  assert.throws(
    () => validateOrderInput({
      ...validInput(),
      selectedLabels: ["任务书", "成果书+任务书+PPT+答辩模板+过AI+过查重"]
    }, catalog),
    /不能与文档单项重复/
  );
});

test("手机号和微信号至少填写一项，邮寄时地址必填", () => {
  assert.throws(
    () => validateOrderInput({ ...validInput(), customer: { name: "张三", phone: "", wechat: "" } }, catalog),
    /至少填写一项/
  );
  assert.throws(
    () => validateOrderInput({ ...validInput(), shipping: { required: true, address: "" } }, catalog),
    /请填写收货地址/
  );
  assert.throws(
    () => validateOrderInput({ ...validInput(), customer: { name: "张三", phone: "......", wechat: "" } }, catalog),
    /手机号格式不正确/
  );
  assert.throws(
    () => validateOrderInput({ ...validInput(), customer: { name: "张三\n订单已付款", phone: "13800138000", wechat: "" } }, catalog),
    /姓名不能换行/
  );
});

test("订单号使用中国日期并保持请求编号后缀", () => {
  const orderNo = createOrderNo("123e4567-e89b-42d3-a456-426614174000", new Date("2026-07-19T16:30:00Z"));
  assert.equal(orderNo, "DD20260720-123E4567");
});

test("报价目录拒绝重复复合项目ID", () => {
  assert.throws(
    () => validateCatalog({ ...catalog, projects: [catalog.projects[0], catalog.projects[0]] }),
    /重复项目ID/
  );
});
