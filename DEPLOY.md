# 运维手册 · MallEX 算力卡计算器

> 这份文档写给未来的你（和未来的我）。改动代码、部署、出问题时先看这里。
> 最后更新：2026-11-10

---

## 一、这东西是什么

一个纯静态网页计算器，用来推算 MallEX 算力卡的每日产出、余额走势、购买额度与到期事件。

- 无后端、无数据库、无构建步骤——**改完文件直接就是最终产物**
- 所有计算在前端完成，所有数据存在浏览器的 `localStorage` 里
- 手机优先布局，桌面端也能用

---

## 二、线上地址与架构

```
本地工作副本
  D:\DeepSeek Harness\Program\mallex-calculator\
        │  git push
        ▼
GitHub  lumengde123/mallex-calculator   (public)
        │  自动触发
        ▼
Vercel  项目 mallex-calculator
        │  ● https://mallex-calculator.vercel.app      ← 默认域名，永远可用
        │  ● https://mex.1sj.top                        ← 自定义域名
        ▼
Cloudflare DNS  1sj.top（NS: daisy / rory.ns.cloudflare.com）
```

**关键点：**

- GitHub → Vercel 是自动联动的。`git push` 之后大约 10–30 秒自动发布，不用手动操作。
- Cloudflare 只负责 DNS，不代理这个站（灰云，仅 DNS）。
- Vercel 免费额度足够用：静态站不消耗函数调用，只算带宽和构建次数。

---

## 三、文件结构

| 文件 | 作用 | 改它要注意 |
| --- | --- | --- |
| `index.html` | 页面骨架（约 340 行，59 个 id） | 改完要检查所有 id 和 app.js 对得上 |
| `styles.css` | 全部样式（含 `@media` 手机端分支） | 有 `?v=N` 版本号，见下方 |
| `app.js` | 全部逻辑（约 1960 行，单个 IIFE） | 同上 |
| `README.md` | 给使用者看的功能说明与规则表 | 改动功能时同步 |
| `DEPLOY.md` | 本文件，给维护者看 | — |

### 版本号必须手动改 ⚠️

`index.html` 底部有两行：

```html
<link rel="stylesheet" href="./styles.css?v=20" />
<script src="./app.js?v=27"></script>
```

**每次改完 `styles.css` 或 `app.js`，必须把这个数字加一**，否则用户的浏览器会继续用缓存里的旧文件，表现为「代码明明改了，页面没变化」。这是本项目最容易踩的坑。

改的时候用编辑器精确改那一行即可，别用脚本批量替换（见第七节）。

---

## 四、本地预览

```powershell
python -m http.server 8791 --bind 0.0.0.0 --directory "D:\DeepSeek Harness\Program\mallex-calculator"
```

然后浏览器打开 `http://127.0.0.1:8791/`。

- 加 `--bind 0.0.0.0` 是为了让同一 WiFi 下的手机也能访问（用电脑的局域网 IP，例如 `http://192.168.2.112:8791/`）。电脑 IP 会变，用 `ipconfig` 查。
- 直接双击 `index.html`（`file://`）大部分功能也能用，但导出/剪贴板某些浏览器会受限，建议走 http。
- 防火墙要放行 python 的入站连接，首次运行时系统会弹窗。

---

## 五、改完代码怎么发布

```powershell
cd "D:\DeepSeek Harness\Program\mallex-calculator"
git add -A
git commit -m "说明这次改了什么"
git push
```

推上去就完事了，Vercel 会自动构建并发布。想确认结果去
`https://vercel.com/lumengde123s-projects/mallex-calculator` 看部署列表。

**回滚**：在 Vercel 项目页 → Deployments → 找到上一个正常版本 → 右侧菜单「Promote to Production」。

**git 认证**：这台机器上 `git push` 目前靠一个 PAT。如果哪天提示认证失败，去
https://github.com/settings/tokens 新建一个（勾 `repo` 权限），然后：

```powershell
git remote set-url origin https://<用户名>:<新token>@github.com/lumengde123/mallex-calculator.git
git push
git remote set-url origin https://github.com/lumengde123/mallex-calculator.git   # 推完换回来，别把 token 留在配置里
```

---

## 六、数据存在哪、怎么迁移

**所有数据只存在你当前浏览器的 `localStorage` 里，没有云端同步。**

| localStorage 键 | 内容 |
| --- | --- |
| `mallex-calc-profiles` | 多存档容器：`{ activeId, list: [{ id, name, updatedAt, data }] }` |
| `mallex-fold` | 五张卡片的折叠状态 |

`data` 里是这个存档的全套数据：`balance` / `startDate` / `horizon` / `holdings` / `manual` / `auto` / `coins` / `rates` / `view` / `skipPast`。

**换设备 / 换浏览器怎么搬：**

页面右上角「存档」→「导出并复制」→ 得到一串 `MEX1:` 开头的文本 → 在新设备上打开同一页面 → 粘贴到框里 → 点「导入」。

**什么情况会丢数据：**

- 清理浏览器数据 / 无痕模式 / 换浏览器 / 换设备
- 站点地址变了（`mallex-calculator.vercel.app` 和 `mex.1sj.top` 是**两个不同的域**，localStorage 不互通！）

最后这条要特别注意：域名切换后，老数据留在旧域名下。想看老数据就开旧地址导出，再导入新地址。

---

## 七、维护红线 ⚠️

### 1. 不要用 PowerShell 批量改含中文的文件

曾经用 `(Get-Content -Raw) -replace ... | Set-Content -Encoding UTF8` 改 `index.html`，
PowerShell 5.1 按系统 GBK 解码 UTF-8，**整个文件的中文变成乱码且不可逆**，只能整份重写。

改文件用编辑器 / `edit` 工具精确替换，别写命令行批量替换脚本。

### 2. 改完记得 bump 版本号

见第三节。

### 3. 改 `index.html` 后核对 id

`app.js` 靠 `$('#xxx')` 抓元素，少一个 id 就会在运行时抛错，表现为「页面一半不渲染」。

---

## 八、DNS 与域名

`1sj.top` 托管在 Cloudflare，NS 是 `daisy.ns.cloudflare.com` / `rory.ns.cloudflare.com`。

`mex.1sj.top` 需要的记录：

| 类型 | 名称 | 目标 | 代理 |
| --- | --- | --- | --- |
| CNAME | mex | `28168fa4425e64f0.vercel-dns-017.com` | **仅 DNS（灰云）** |

- 灰云是必须的。开橙云会让流量先过 Cloudflare，Vercel 的证书对不上，出现 526。
- 若哪天 Vercel 换了 CNAME 目标（重新添加域名可能变），以 `vercel domains verify mex.1sj.top` 的输出为准。
- 检查 DNS 是否生效：`nslookup mex.1sj.top`，返回的应该是一个 Vercel 的 IP。

---

## 九、出问题先查这几条

| 现象 | 先查 |
| --- | --- |
| 改的代码没生效 | 版本号 bump 了吗？硬刷新（Ctrl+Shift+R）？Vercel 部署成功了吗？ |
| 页面一半空白 | 浏览器控制台看报错，多半是 `index.html` 少了某个 id |
| 手机打开是空数据 | 正常，localStorage 不跨设备。用「导出/导入」搬 |
| 域名打不开 / 526 | DNS 是不是开成橙云了；或 CNAME 目标过时 |
| 部署失败 | Vercel 部署日志；多半是文件写坏了（中文乱码会让 HTML 结构崩） |
| 金额和预期对不上 | 先确认起算日、余额口径（余额是起算日**结束**时的余额）、以及同一天的操作顺序 |

---

## 十、业务规则速查

八种卡的买入价 / 到期本息 / 额度 / 活跃度：

| 卡种 | 买入价 | 到期本息 | 额度 | 活跃度 |
| --- | --- | --- | --- | --- |
| 初级1 | 5 | 6 | 8 | 0.5 |
| 初级2 | 10 | 12 | 4 | 1 |
| 中级 | 100 | 123 | 4 | 10 |
| 进阶 | 500 | 630 | 3 | 50 |
| 高级 | 1,000 | 1,290 | 2 | 100 |
| 精英 | 2,000 | 2,640 | 1 | 200 |
| 超级 | 5,000 | 6,750 | 1 | 500 |
| 专家 | 10,000 | 13,800 | 1 | 1,000 |

- 每日产出 = 到期本息 ÷ 持有天数（35 天或 40 天）
- 购买当天不计产出，次日开始
- 活跃度 > 100 时买的卡走 40 天新版规则，否则 35 天
- 额度是「同时持有上限」，到期**次日零点**才释放
- M 币就是 MEX 的简称，买卖直接加减余额

---

## 十一、常用命令速查

```powershell
# 本地起服务
python -m http.server 8791 --bind 0.0.0.0 --directory "D:\DeepSeek Harness\Program\mallex-calculator"

# 查本机局域网 IP（手机访问用）
ipconfig

# 检查 JS 语法
node --check app.js

# 检查自定义域名配置
npx vercel domains verify mex.1sj.top --token <你的token>

# 查看 DNS 解析
nslookup mex.1sj.top
```

---

## 十二、凭据与安全

- **不要把 GitHub PAT、Vercel Token 写进任何文件或提交进仓库**。用一次就删。
- 用完的 token 清理入口：
  - GitHub：https://github.com/settings/tokens
  - Vercel：https://vercel.com/account/settings/tokens
- `.gitignore` 里已经排除了本地临时文件（`_preview.html`、`*.broken.html` 等）。
