const PALETTE = ["#118b86", "#2b71b8", "#8c62bd", "#d47b32", "#4d8f4e", "#b64f6f"];

export function normalizeText(value) {
  return String(value ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

function searchableText(project) {
  return normalizeText([
    project.id,
    project.code,
    project.title,
    project.series,
    project.mcuFamily,
    project.mcuModel,
    ...(project.usages || []),
    ...(project.modules || []),
    project.description,
    ...(project.keywords || [])
  ].join(" "));
}

export function searchProjects(projects, query) {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const tokens = normalized.split(" ").filter(Boolean);

  return projects
    .map((project) => {
      const id = normalizeText(project.id);
      const code = normalizeText(project.code);
      const title = normalizeText(project.title);
      const all = searchableText(project);
      if (!tokens.every((token) => all.includes(token))) return null;
      const exact = id === normalized || code === normalized || title === normalized;
      let score = exact ? 1000 : 0;
      if (id.includes(normalized)) score += 80;
      if (code.includes(normalized)) score += 80;
      if (title.includes(normalized)) score += 60;
      for (const token of tokens) {
        if (title.includes(token)) score += 12;
        if (id.includes(token)) score += 10;
        if (code.includes(token)) score += 10;
        if (normalizeText(project.mcuFamily).includes(token)) score += 6;
        if (normalizeText(project.mcuModel).includes(token)) score += 6;
      }
      return { project, score, exact };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.project.sort - b.project.sort);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatPrice(value) {
  if (typeof value === "number") {
    if (value === 0) return "免费";
    return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  }
  return String(value || "价格咨询");
}

function priceSummary(prices = []) {
  const numeric = prices.map((item) => item.price).filter((value) => typeof value === "number");
  if (numeric.length) return `${formatPrice(Math.min(...numeric))} 起`;
  return prices.length ? formatPrice(prices[0].price) : "价格咨询";
}

export function priceSelectionSummary(selectedPrices = []) {
  const numeric = selectedPrices.filter((item) => typeof item.price === "number");
  const consulting = selectedPrices.length - numeric.length;
  const total = numeric.reduce((sum, item) => sum + item.price, 0);
  if (!selectedPrices.length) return "已选 0 项，合计 ¥0";
  if (consulting && !numeric.length) return `已选 ${selectedPrices.length} 项，价格需咨询`;
  if (consulting) return `已选 ${selectedPrices.length} 项，已知合计 ${formatPrice(total)}，另有 ${consulting} 项需咨询`;
  return `已选 ${selectedPrices.length} 项，合计 ${formatPrice(total)}`;
}

export function buildRequirementText(project, selectedPrices = [], note = "") {
  if (!selectedPrices.length) return "";
  const lines = selectedPrices.map((item, index) => `${index + 1}. ${item.label}：${formatPrice(item.price)}`);
  const result = [
    `项目名称：${project.title || "未填写"}`,
    `项目编号：${project.code || project.id || "未填写"}`,
    "需求组合：",
    ...lines,
    `报价结果：${priceSelectionSummary(selectedPrices)}`
  ];
  if (note.trim()) result.push(`备注：${note.trim()}`);
  return result.join("\n");
}

function groupCounts(projects, selector) {
  const counts = new Map();
  for (const project of projects) {
    for (const value of selector(project)) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

function createProjectCard(project, exact = false) {
  const card = element("article", "project-card");
  const top = element("div", "project-topline");
  top.append(element("span", "project-id", project.code || project.id));
  const topMeta = element("div", "project-top-meta");
  if (exact) topMeta.append(element("span", "exact-badge", "精准匹配"));
  if (project.prices?.length) {
    topMeta.append(element("span", "project-price", priceSummary(project.prices)));
  } else {
    const consult = element("details", "price-consult");
    consult.append(
      element("summary", "project-price", "价格咨询"),
      element("p", "price-consult-note", `该项目暂未录入公开价格，请提供项目编号 ${project.code || project.id} 咨询。`)
    );
    topMeta.append(consult);
  }
  top.append(topMeta);
  card.append(top, element("h3", "", project.title));

  const mcu = [project.mcuFamily, project.mcuModel].filter(Boolean).join(" / ");
  if (mcu) card.append(element("p", "project-mcu", mcu));
  if (project.description) card.append(element("p", "project-description", project.description));

  const chips = element("div", "chip-row");
  for (const usage of (project.usages || []).slice(0, 3)) chips.append(element("span", "chip", usage));
  for (const module of (project.modules || []).slice(0, 3)) chips.append(element("span", "chip module", module));
  card.append(chips);

  if (project.prices?.length) {
    const details = element("details", "price-options");
    details.open = true;
    const summary = element("summary", "", `自由组合 ${project.prices.length} 种价格方案`);
    const list = element("div", "price-list");
    const choices = [];
    for (const option of project.prices) {
      const row = element("label", "price-row");
      const choice = element("span", "price-choice");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      choice.append(checkbox, element("span", "", option.label));
      row.append(choice, element("strong", "", formatPrice(option.price)));
      list.append(row);
      choices.push({ checkbox, option });
    }
    const total = element("output", "price-total", priceSelectionSummary());
    total.setAttribute("aria-live", "polite");
    const noteLabel = element("label", "quote-note-label");
    const note = element("textarea", "quote-note-input");
    note.rows = 3;
    note.placeholder = "例如：需要加急、修改功能、指定芯片型号等";
    noteLabel.append(element("span", "", "备注（选填）"), note);
    const confirm = element("button", "confirm-quote", "确认需求");
    confirm.type = "button";
    confirm.disabled = true;

    const confirmation = element("div", "quote-confirmation");
    confirmation.hidden = true;
    const confirmationTitle = element("h4", "", "需求已确认");
    const quoteText = element("textarea", "quote-text");
    quoteText.readOnly = true;
    quoteText.rows = 8;
    quoteText.setAttribute("aria-label", "已确认的项目需求");
    const copy = element("button", "copy-quote", "一键复制需求发送给客服");
    copy.type = "button";
    const copyHint = element("p", "quote-hint", "复制后，请扫码添加客服微信并粘贴发送。");
    const qr = element("img", "wechat-qr");
    qr.src = "./assets/customer-wechat.png";
    qr.alt = "客服微信二维码";
    qr.loading = "lazy";
    confirmation.append(confirmationTitle, quoteText, copy, copyHint, qr);

    const selectedOptions = () => choices.filter(({ checkbox }) => checkbox.checked).map(({ option }) => option);
    const resetConfirmation = () => {
      confirmation.hidden = true;
      copy.textContent = "一键复制需求发送给客服";
    };
    list.addEventListener("change", () => {
      const selected = selectedOptions();
      total.textContent = priceSelectionSummary(selected);
      confirm.disabled = !selected.length;
      resetConfirmation();
    });
    note.addEventListener("input", resetConfirmation);
    confirm.addEventListener("click", () => {
      quoteText.value = buildRequirementText(project, selectedOptions(), note.value);
      confirmation.hidden = false;
      confirmation.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    copy.addEventListener("click", async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(quoteText.value);
        } else {
          quoteText.focus();
          quoteText.select();
          if (!document.execCommand("copy")) throw new Error("复制失败");
        }
        copy.textContent = "已复制，请发送给客服";
      } catch {
        quoteText.focus();
        quoteText.select();
        copy.textContent = "复制失败，请手动复制";
      }
    });
    details.append(summary, list, total, noteLabel, confirm, confirmation);
    card.append(details);
  }
  return card;
}

function createEmpty(title, copy) {
  const empty = element("div", "empty-state");
  empty.append(element("strong", "", title), element("span", "", copy));
  return empty;
}

if (typeof document !== "undefined") {
  const refs = {
    input: document.querySelector("#project-search"),
    clear: document.querySelector("#clear-search"),
    hint: document.querySelector("#search-hint"),
    panel: document.querySelector("#search-panel"),
    searchCount: document.querySelector("#search-count"),
    searchResults: document.querySelector("#search-results"),
    breadcrumbs: document.querySelector("#breadcrumbs"),
    kicker: document.querySelector("#catalog-kicker"),
    title: document.querySelector("#catalog-title"),
    description: document.querySelector("#catalog-description"),
    tabs: document.querySelector("#mode-tabs"),
    content: document.querySelector("#catalog-content"),
    loadMoreWrap: document.querySelector("#load-more-wrap"),
    loadMore: document.querySelector("#load-more"),
    source: document.querySelector("#data-source"),
    updated: document.querySelector("#updated-at")
  };

  const state = {
    projects: [],
    meta: {},
    mcu: "",
    mode: "usage",
    category: "",
    query: "",
    limit: 24
  };

  function readRoute() {
    const params = new URLSearchParams(location.hash.slice(1));
    state.mcu = params.get("mcu") || "";
    state.mode = params.get("mode") === "module" ? "module" : "usage";
    state.category = params.get("category") || "";
  }

  function writeRoute(push = true) {
    const params = new URLSearchParams();
    if (state.mcu) params.set("mcu", state.mcu);
    if (state.mcu) params.set("mode", state.mode);
    if (state.category) params.set("category", state.category);
    const hash = params.toString() ? `#${params}` : location.pathname + location.search;
    history[push ? "pushState" : "replaceState"]({}, "", hash);
  }

  function currentScope() {
    let projects = state.projects;
    if (state.mcu) projects = projects.filter((project) => project.mcuFamily === state.mcu);
    if (state.category) {
      const field = state.mode === "module" ? "modules" : "usages";
      projects = projects.filter((project) => (project[field] || []).includes(state.category));
    }
    return projects;
  }

  function renderStats() {
    document.querySelector("#stat-projects").textContent = state.projects.length.toLocaleString("zh-CN");
    document.querySelector("#stat-mcus").textContent = unique(state.projects.map((project) => project.mcuFamily)).length;
    document.querySelector("#stat-usages").textContent = unique(state.projects.flatMap((project) => project.usages || [])).length;
    document.querySelector("#stat-modules").textContent = unique(state.projects.flatMap((project) => project.modules || [])).length;
  }

  function renderBreadcrumbs() {
    refs.breadcrumbs.replaceChildren();
    const home = element("button", "", "全部单片机");
    home.type = "button";
    home.addEventListener("click", () => navigate({ mcu: "", category: "" }));
    refs.breadcrumbs.append(home);

    if (state.mcu) {
      refs.breadcrumbs.append(element("span", "breadcrumb-separator", "/"));
      if (state.category) {
        const mcu = element("button", "", state.mcu);
        mcu.type = "button";
        mcu.addEventListener("click", () => navigate({ category: "" }));
        refs.breadcrumbs.append(mcu, element("span", "breadcrumb-separator", "/"), element("span", "", state.category));
      } else {
        refs.breadcrumbs.append(element("span", "", state.mcu));
      }
    }
  }

  function renderTabs() {
    refs.tabs.hidden = !state.mcu;
    for (const button of refs.tabs.querySelectorAll("button")) {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function createCategoryCard(name, count, index, onClick) {
    const card = element("button", "category-card");
    card.type = "button";
    card.style.setProperty("--card-accent", PALETTE[index % PALETTE.length]);
    card.append(element("span", "category-index", String(index + 1).padStart(2, "0")), element("h3", "", name));
    const meta = element("div", "category-meta");
    meta.append(element("span", "", `${count} 个项目`), element("span", "category-arrow", "→"));
    card.append(meta);
    card.addEventListener("click", onClick);
    return card;
  }

  function renderCatalog() {
    refs.content.replaceChildren();
    refs.loadMoreWrap.hidden = true;
    refs.content.className = state.category ? "project-grid" : "category-grid";

    if (!state.mcu) {
      refs.kicker.textContent = "第一步";
      refs.title.textContent = "选择单片机类型";
      refs.description.textContent = "从主控平台开始浏览课题，卡片数量表示该分类下的项目数。";
      const groups = groupCounts(state.projects, (project) => [project.mcuFamily || "综合与其他"]);
      for (const [name, count] of groups) {
        refs.content.append(createCategoryCard(name, count, refs.content.childElementCount, () => navigate({ mcu: name, category: "" })));
      }
      return;
    }

    if (!state.category) {
      const byModule = state.mode === "module";
      refs.kicker.textContent = "第二步";
      refs.title.textContent = byModule ? `${state.mcu} / 选择使用模块` : `${state.mcu} / 选择项目用途`;
      refs.description.textContent = byModule ? "按项目使用的传感器、显示屏和通信模块继续筛选。" : "按检测、控制、物联网等实际用途继续筛选。";
      const selector = byModule
        ? (project) => project.modules?.length ? project.modules : ["未标注模块"]
        : (project) => project.usages?.length ? project.usages : ["综合应用"];
      const groups = groupCounts(currentScope(), selector);
      for (const [name, count] of groups) {
        refs.content.append(createCategoryCard(name, count, refs.content.childElementCount, () => navigate({ category: name })));
      }
      if (!groups.length) refs.content.append(createEmpty("暂无分类", "请先在在线表格中补充用途或模块字段。"));
      return;
    }

    const projects = currentScope();
    refs.kicker.textContent = "项目列表";
    refs.title.textContent = state.category;
    refs.description.textContent = `${state.mcu} / ${projects.length} 个匹配项目`;
    for (const project of projects.slice(0, state.limit)) refs.content.append(createProjectCard(project));
    if (!projects.length) refs.content.append(createEmpty("暂无项目", "该分类暂时没有可展示的课题。"));
    refs.loadMoreWrap.hidden = projects.length <= state.limit;
  }

  function renderSearch() {
    const query = state.query.trim();
    refs.clear.hidden = !query;
    refs.panel.hidden = !query;
    if (!query) return;

    const results = searchProjects(currentScope(), query);
    refs.searchCount.textContent = `找到 ${results.length} 个项目`;
    refs.searchResults.replaceChildren();
    for (const result of results.slice(0, 12)) refs.searchResults.append(createProjectCard(result.project, result.exact));
    if (!results.length) refs.searchResults.append(createEmpty("没有找到匹配项目", "试试缩短关键词，或返回上一级扩大搜索范围。"));
  }

  function renderHint() {
    if (state.category) {
      refs.hint.textContent = `当前搜索范围：${state.mcu} / ${state.category}`;
      refs.input.placeholder = `在“${state.category}”中搜索项目…`;
    } else if (state.mcu) {
      refs.hint.textContent = `当前搜索范围：${state.mcu}`;
      refs.input.placeholder = `在“${state.mcu}”中搜索用途、模块或编号…`;
    } else {
      refs.hint.textContent = "可搜索：STM32、温湿度、超声波、项目编号";
      refs.input.placeholder = "输入项目编号、名称、用途或模块…";
    }
  }

  function render() {
    renderBreadcrumbs();
    renderTabs();
    renderCatalog();
    renderHint();
    renderSearch();
  }

  function navigate(patch, push = true) {
    if (Object.hasOwn(patch, "mcu") && patch.mcu !== state.mcu) patch.category = "";
    Object.assign(state, patch, { limit: 24 });
    writeRoute(push);
    render();
    document.querySelector(".catalog").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  refs.input.addEventListener("input", () => {
    state.query = refs.input.value;
    renderSearch();
  });
  refs.clear.addEventListener("click", () => {
    state.query = "";
    refs.input.value = "";
    renderSearch();
    refs.input.focus();
  });
  document.querySelector("#search-form").addEventListener("submit", (event) => event.preventDefault());
  refs.tabs.addEventListener("click", (event) => {
    const mode = event.target.closest("button")?.dataset.mode;
    if (mode && mode !== state.mode) navigate({ mode, category: "" });
  });
  refs.loadMore.addEventListener("click", () => {
    state.limit += 24;
    renderCatalog();
  });
  window.addEventListener("popstate", () => {
    readRoute();
    render();
  });

  try {
    const response = await fetch("./data/projects.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.projects = Array.isArray(payload.projects) ? payload.projects : [];
    state.meta = payload.meta || {};
    refs.source.textContent = `数据来源：${state.meta.source || "在线课题表"}`;
    readRoute();
    renderStats();
    render();
    const generatedAt = state.meta.generatedAt ? new Date(state.meta.generatedAt) : null;
    refs.updated.textContent = generatedAt && !Number.isNaN(generatedAt.valueOf())
      ? `最近更新：${generatedAt.toLocaleString("zh-CN", { hour12: false })}`
      : "数据已加载";
  } catch (error) {
    refs.content.replaceChildren(createEmpty("数据加载失败", "请稍后刷新页面，或检查自动同步任务。"));
    refs.updated.textContent = "数据加载失败";
    console.error(error);
  }
}
