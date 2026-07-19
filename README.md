# 智造课题库

用于展示单片机毕业设计项目的静态网站。唯一数据源是 `data/项目链接清单.xlsx`，替换并上传该文件后，GitHub Actions 会自动校验、转换和发布 GitHub Pages。

## 项目目录

```text
毕业设计资料库_/
├─ data/
│  └─ 项目链接清单.xlsx      # 唯一上传数据源，项目必需
├─ site/                     # GitHub Pages静态网站
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ data/
│     └─ projects.json       # Excel自动生成，禁止手工修改
├─ scripts/                  # Excel解析和本地预览脚本
├─ test/                     # Excel校验和网页搜索测试
├─ .github/workflows/        # GitHub自动解析与部署流程
├─ package.json              # 本地预览命令
├─ requirements.txt          # Excel解析依赖
├─ README.md                 # 使用说明
└─ 1/                        # 备份、旧版和临时文件，不参与项目运行
```

`1/` 已加入 `.gitignore`，不会上传到 GitHub。

## Excel 字段

工作表名称保持为 `项目链接清单`，第一行是表头，每行对应一个项目。

| 字段 | 是否必填 | 填写说明 |
|---|---:|---|
| 序号 | 否 | 便于人工查看 |
| 项目系列 | 否 | 如 Y系列、S系列STM32单片机 |
| 项目编号 | 是 | 同一项目系列内不能重复 |
| 项目名称 | 是 | 客户看到的项目标题 |
| 单片机分类 | 是 | 如 STM32、51单片机、ESP32 |
| 单片机型号 | 否 | 如 STM32F103C8T6、STC89C52 |
| 项目用途 | 否 | 多项用顿号或逗号分隔 |
| 使用模块 | 否 | 多项用顿号或逗号分隔 |
| 项目简介 | 否 | 简短功能介绍 |
| 资料主要内容 | 否 | 仅保留在Excel中，不进入网页数据 |
| 仿真+仿真代码 | 否 | 填金额、面议、咨询或留空 |
| 原理图+PCB设计 | 否 | 填金额、面议、咨询或留空 |
| 硬件实物+配套硬件代码 | 否 | 填金额、面议、咨询或留空 |
| 论文 | 否 | 填金额、面议、咨询或留空 |
| 是否展示 | 否 | 填“是”或“否”，默认为“是” |
| 排序 | 否 | 整数，越小越靠前 |

网站卡片会显示最低价格，例如 `¥100 起`；展开后列出各个价格方案。所有价格均为空时显示“价格咨询”。

## 隐私说明

- `下载链接`、`资料介绍链接`和`资料主要内容`不会进入 `projects.json`，网页也不会展示。
- GitHub 公开仓库中的 Excel 本身可以被下载。如果不希望别人从原始 Excel 看到“资料主要内容”，上传前请清空该列。
- 备份和旧版文件统一放在 `1/`，不要放在项目根目录。

## 日常更新方式

1. 打开 `data/项目链接清单.xlsx`。
2. 新增、修改价格或将“是否展示”改为“否”，然后保存。
3. 在 GitHub 仓库中进入 `data` 文件夹，点击 `Add file → Upload files`。
4. 上传并替换同名文件 `项目链接清单.xlsx`。
5. 点击 `Commit changes`，等待约 1～3 分钟。

不需要手工修改 JSON，不需要 WPS、飞书、API 或 GitHub Secrets。

## 自动校验

发布前会检查：

- 必填表头和必填单元格
- 同一项目系列内的编号重复
- 排序字段是否为整数
- 价格是否为非负金额、面议、咨询或空白
- 是否包含禁止公开的下载链接列
- 是否至少存在一个可展示项目

校验失败时不会发布新版本，现有网站继续正常运行；具体错误行会显示在 Actions 日志中。

## 本地预览

直接打开 `site/index.html` 即可查看现有页面。需要本地服务器时：

```powershell
npm start
```

然后打开 `http://127.0.0.1:4173`。这个地址只在命令运行期间有效。

修改 Excel 后，如需本地重新生成网页数据：

```powershell
python -m pip install -r requirements.txt
python scripts/excel_to_json.py
```

## GitHub Pages

首次上传仓库后，在 `Settings → Pages → Source` 中选择 **GitHub Actions**。以后只要替换 `data/项目链接清单.xlsx`，网站就会自动更新。

## 测试

```powershell
python -m unittest discover -s test -p "test_*.py"
node --test
```
