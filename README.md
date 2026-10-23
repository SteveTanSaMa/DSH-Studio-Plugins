# DSH Studio Plugins

DSH Studio 的私有插件索引原型，供官方 Custom plugin markets 读取。

当前仅包含两个用于技术测试的精确 npm 版本，**不是已通过 Studio 功能验证的推荐清单**。本仓库不公开部署，GitHub 项目页、文件浏览页和需要登录的 raw URL 不能直接作为 Discover 源。

## 本地使用

使用 `.node-version` 指定的 Node 26.12.1：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
npm run check
npm run test:integration
npm run serve
```

最后一条命令打印仅本机可访问的临时 HTTP 索引链接；可在同一台机器的 Harness 中启用 Custom plugin markets，并主动添加该链接。结束服务后此链接失效，请从测试 Profile 移除。远程 Harness 无法访问本机 loopback 地址。

测试使用临时目录和隔离 Profile，不读取或修改用户已有 Profile。社区候选只下载与检查发布包；集成测试实际安装、启用、卸载的是本地生成的无依赖测试 bundle。官方 Host/Settings/Plugin Manager 与真实 pnpm 参与测试；没有模拟这些服务。

## 文件与职责

| 文件 | 维护内容 |
| --- | --- |
| `data/sources.json` | 精确包版本、已审核的 SHA-512、目标 Harness 版本 |
| `data/curation.json` | 中英说明、分类；候选必须注明验证状态 |
| `data/withdrawn.json` | 下架包名、可选版本和原因 |
| `public/index.json` | 自动生成的官方 format 1 索引 |
| `public/status.json` | 发布包身份、许可证、兼容声明、体积、检查时间与未执行的功能测试 |
| `docs/PLAN.md` | 初步验证计划 |
| `docs/INITIAL_TEST_REPORT.md` | 实际结果与边界 |

索引更新独立于 App 与 Runtime 发布；Runtime 签名目录不承担社区索引的信任含义。源列表只属于 Harness Profile，不在 Studio 另外存一份。

## 更新与下架

1. 新版本进入 PR，同时更新精确版本和 SHA-512；不使用 `latest`、版本范围或浮动 Git 分支。
2. 运行发布包核验、官方格式校验和集成测试，补充真实功能测试记录。
3. 审核后合并。CI 只生成私有预览附件，不自动发布网站、不修改 App 设置。
4. 上游临时失败时构建失败并保留上次完整产物；不会偷偷减少插件或改用未经审核版本。
5. 下架时同时从 `sources.json` 与 `curation.json` 移除并写入 `withdrawn.json`，重新生成；若清单仍包含下架条目，CI 拒绝构建。已发布旧源仍可能保留该版本，正式部署时需完成替换和缓存验证。下架不会自动卸载用户已有插件。

每周一 CI 重新核验精确版本，检测失效、撤回和完整性变化；没有自动批准新版本的步骤。生成失败不会覆盖 `public/`，正式部署仍需选择支持完整目录切换的静态托管方案。

## 后续发布约定

正式源预期采用稳定 HTTPS 路径 `/index.json`，直接返回 200 JSON，无重定向、登录或令牌要求。预览源采用独立路径。当前没有已部署的公网插件链接。

正式发布前还需真实候选的 Web UI/功能与 macOS 架构验证、部署与回滚演练及网络可达性验证。将来在 Studio 提供添加按钮时，仅通过官方 `setIndexes` 追加并保留其他源，尊重用户删除。
