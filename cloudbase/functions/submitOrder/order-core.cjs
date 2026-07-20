"use strict";

const DOCUMENT_PACKAGE_LABEL = "成果书+任务书+PPT+答辩模板+过AI+过查重";
const DOCUMENT_SINGLE_LABELS = new Set(["成果书", "任务书", "PPT送答辩模板", "论文"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^[0-9+().\-\s]{6,30}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/;

class InputError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "InputError";
    this.statusCode = statusCode;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, maxLength, label, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string") throw new InputError(400, `${label}格式不正确`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new InputError(400, `请填写${label}`);
  if ([...cleaned].length > maxLength) throw new InputError(400, `${label}内容过长`);
  if (CONTROL_CHARACTER_PATTERN.test(cleaned)) throw new InputError(400, `${label}包含无效字符`);
  return cleaned;
}

function cleanSingleLine(value, maxLength, label, required = false) {
  const cleaned = cleanString(value, maxLength, label, required);
  if (LINE_BREAK_PATTERN.test(cleaned)) throw new InputError(400, `${label}不能换行`);
  return cleaned;
}

function isValidPhone(value) {
  if (!PHONE_PATTERN.test(value)) return false;
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 6 && digitCount <= 20;
}

function validateCatalog(catalog) {
  if (!isPlainObject(catalog) || !isPlainObject(catalog.meta) || !Array.isArray(catalog.projects)) {
    throw new Error("报价目录结构无效");
  }
  const generatedAt = cleanSingleLine(catalog.meta.generatedAt, 80, "报价版本", true);
  const ids = new Set();
  for (const project of catalog.projects) {
    if (!isPlainObject(project) || typeof project.id !== "string" || !project.id.trim()) {
      throw new Error("报价目录包含无效项目");
    }
    if (ids.has(project.id)) throw new Error("报价目录包含重复项目ID");
    ids.add(project.id);
  }
  return { generatedAt, projects: catalog.projects };
}

function validateOrderInput(input, catalog) {
  if (!isPlainObject(input)) throw new InputError(400, "提交内容格式不正确");
  if (cleanSingleLine(input.website, 100, "校验字段")) throw new InputError(400, "提交失败，请重试");

  const requestId = cleanSingleLine(input.requestId, 50, "请求编号", true);
  if (!UUID_PATTERN.test(requestId)) throw new InputError(400, "请求编号格式不正确");

  const checkedCatalog = validateCatalog(catalog);
  const catalogGeneratedAt = cleanSingleLine(input.catalogGeneratedAt, 80, "报价版本", true);
  if (catalogGeneratedAt !== checkedCatalog.generatedAt) {
    throw new InputError(409, "报价数据已经更新，请刷新页面后重新选择");
  }

  const projectId = cleanSingleLine(input.projectId, 120, "项目编号", true);
  const project = checkedCatalog.projects.find((item) => item.id === projectId);
  if (!project) throw new InputError(400, "所选项目不存在");
  if (!Array.isArray(project.prices) || !project.prices.length) {
    throw new InputError(400, "该项目暂无可提交的报价方案");
  }

  if (!Array.isArray(input.selectedLabels) || input.selectedLabels.length < 1 || input.selectedLabels.length > 8) {
    throw new InputError(400, "请选择1至8个报价方案");
  }
  const selectedLabels = input.selectedLabels.map((label) => cleanSingleLine(label, 80, "报价方案", true));
  if (new Set(selectedLabels).size !== selectedLabels.length) {
    throw new InputError(400, "报价方案不能重复选择");
  }
  if (
    selectedLabels.includes(DOCUMENT_PACKAGE_LABEL)
    && selectedLabels.some((label) => DOCUMENT_SINGLE_LABELS.has(label))
  ) {
    throw new InputError(400, "全套文档服务不能与文档单项重复选择");
  }

  const availablePrices = new Map();
  for (const option of project.prices) {
    if (!isPlainObject(option) || typeof option.label !== "string" || availablePrices.has(option.label)) {
      throw new Error("报价目录包含无效价格方案");
    }
    const value = option.price;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) throw new Error("报价目录包含无效金额");
    } else if (typeof value !== "string" || !value.trim()) {
      throw new Error("报价目录包含无效咨询价格");
    }
    availablePrices.set(option.label, value);
  }

  const items = selectedLabels.map((label) => {
    if (!availablePrices.has(label)) throw new InputError(400, `报价方案“${label}”已失效`);
    const price = availablePrices.get(label);
    return typeof price === "number"
      ? { label, kind: "fixed", amountFen: Math.round(price * 100) }
      : { label, kind: "consult", consultText: price };
  });

  const customer = isPlainObject(input.customer) ? input.customer : {};
  const name = cleanSingleLine(customer.name, 30, "姓名", true);
  const phone = cleanSingleLine(customer.phone, 30, "手机号");
  const wechat = cleanSingleLine(customer.wechat, 50, "微信号");
  if (!phone && !wechat) throw new InputError(400, "手机号和微信号至少填写一项");
  if (phone && !isValidPhone(phone)) throw new InputError(400, "手机号格式不正确");

  const shipping = isPlainObject(input.shipping) ? input.shipping : {};
  if (typeof shipping.required !== "boolean") throw new InputError(400, "邮寄选项格式不正确");
  const address = cleanString(shipping.address, 300, "收货地址", shipping.required);
  if (input.privacyAccepted !== true) throw new InputError(400, "请同意个人信息使用说明");

  return {
    requestId,
    catalogGeneratedAt,
    project: {
      id: project.id,
      code: String(project.code || ""),
      title: String(project.title || "")
    },
    items,
    knownTotalFen: items.reduce((sum, item) => sum + (item.amountFen || 0), 0),
    consultationCount: items.filter((item) => item.kind === "consult").length,
    note: cleanString(input.note, 500, "备注"),
    customer: { name, phone, wechat },
    shipping: { required: shipping.required, address: shipping.required ? address : "" },
    privacyAccepted: true
  };
}

function createOrderNo(requestId, now = new Date()) {
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const date = chinaTime.toISOString().slice(0, 10).replaceAll("-", "");
  return `DD${date}-${requestId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

module.exports = {
  InputError,
  createOrderNo,
  validateCatalog,
  validateOrderInput
};
