# JAYFLIX

<p align="center"><img src="image/logo-jayflix.png" alt="JAYFLIX Logo" width="112"></p>

多源视频搜索与播放前端，采用原生 HTML、CSS、JavaScript。聚合兼容苹果 CMS V10 的第三方接口，不提供、不存储、不上传视频内容。

## 功能

- 多源并行搜索、自定义接口、豆瓣电影及电视剧推荐。
- HLS 播放、选集、自动连播、播放进度恢复。
- 观看与搜索历史、配置导入导出、可选访问与设置密码。
- 首页、播放页、跳转页、关于页及弹窗共用深色与薄荷绿主题，保留原有桌面和移动端适配。
- 首页球面布局按实际数量自适应，支持 **1–1322 张封面**；超出时仅展示返回顺序中的前 1322 张。
- 任意方向拖动、惯性旋转、双指及 Ctrl + 滚轮缩放；卡片始终朝上，透明度随前后位置线性变化。
- 球体与封面独立缩放 **50%–500%**；自动转速 **0%–100%**，默认 50%。控制栏默认收起（→），展开时为 ↘；统一重置恢复当前端默认值。
- 球体比例、封面比例、转速和暂停状态保存在当前浏览器，刷新后恢复；重置后的默认比例和转速也会保存，暂停状态不变。

| 默认比例 | 球体 | 封面 |
| --- | --- | --- |
| 移动端（视口宽度 ≤600px） | 150% | 150% |
| 桌面端（视口宽度 >600px） | 200% | 70% |

## 本地运行

Node.js 18 或更高版本：

```bash
npm ci
npm start
```

访问 `http://localhost:8080`。开发模式：`npm run dev`。

可通过环境变量 `PORT`（默认 8080）、`PASSWORD`（访问密码）、`ADMINPASSWORD`（设置密码）配置服务；密码默认未设置。密码校验主要在浏览器端完成，不能替代平台级身份认证。不要将内置代理作为公共开放代理。

## Cloudflare Pages

连接 GitHub 仓库，生产分支选择 `main`；构建命令留空，输出目录选择仓库根目录。`functions/` 提供视频及图片代理和环境变量注入，必须一起部署；访问与设置密码在平台环境变量中配置。

Git 集成会编译 Pages Functions；也可使用 Wrangler 部署。**不要仅通过控制台拖入静态 ZIP**，该方式不会编译 `functions/`。参见 [Cloudflare 官方说明](https://developers.cloudflare.com/pages/get-started/direct-upload/#functions)。

仓库同时保留 Vercel、Netlify、Render 和 Docker 的原有部署配置。

## 测试

```bash
node --test tests/*.test.mjs
```

`/orbit-test.html` 提供无图片布局与交互测试；`?mode=current` 使用当前首页算法，`?mode=capacity` 提供 1322 个空框的手动压力测试。空框结果不代表加载真实封面后的性能保证。

## 来源与许可

衍生自 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV)，上游基于 [bestK/tv](https://github.com/bestK/tv)。采用 [Apache License 2.0](LICENSE)。第三方接口与内容的可用性、授权由其提供方决定，使用者需自行确认。
