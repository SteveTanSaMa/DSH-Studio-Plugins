# DSH Studio Plugins

DSH Studio 的插件索引原型，供官方 Custom plugin markets 读取。

当前包含两个精确 npm 版本，已在 macOS arm64 完成安装、启用、Web 加载与卸载验证，**完整功能和跨架构验收尚未完成，继续作为测试候选**。仓库已公开，索引通过 GitHub Raw 提供。

## 添加索引源

在 Harness 中启用 **Custom plugin markets**，进入 **Discover → Add index source**，粘贴：

```text
https://raw.githubusercontent.com/SteveTanSaMa/DSH-Studio-Plugins/main/public/index.json
```

这是直接返回 JSON 的固定地址，不需要登录或访问令牌。GitHub 项目页与文件浏览页不是索引地址。检查记录为同目录下的 `status.json`。

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

测试使用临时目录和隔离 Profile，不读取或修改用户已有 Profile。上述自动测试只下载与检查社区发布包；集成测试实际安装、启用、卸载的是本地生成的无依赖测试 bundle。官方 Host/Settings/Plugin Manager 与真实 pnpm 参与测试；没有模拟这些服务。

## 文件与职责

| 文件 | 维护内容 |
| --- | --- |
| `data/sources.json` | 精确包版本、已审核的 SHA-512、目标 Harness 版本 |
| `data/curation.json` | 中英功能说明和分类；验证状态由构建脚本根据证据生成 |
| `data/withdrawn.json` | 下架包名、可选版本和原因 |
| `data/verification.json` | 与精确包身份绑定的人工运行验收记录 |
| `public/index.json` | 自动生成的官方 format 1 索引 |
| `public/status.json` | 发布包身份、许可证、兼容声明、体积、检查时间与未执行的功能测试 |
| `docs/PLAN.md` | 初步验证计划 |
| `docs/INITIAL_TEST_REPORT.md` | 初步链路验证结果 |
| `docs/CANDIDATE_TEST_REPORT.md` | 真实候选验收结果与截图 |

索引更新独立于 App 与 Runtime 发布；Runtime 签名目录不承担社区索引的信任含义。源列表只属于 Harness Profile，不在 Studio 另外存一份。

## 更新与下架

1. 新版本进入 PR，同时更新精确版本和 SHA-512；不使用 `latest`、版本范围或浮动 Git 分支。
2. 运行发布包核验、官方格式校验和集成测试，补充真实功能测试记录。
3. 审核后合并。将重新生成的 `public/index.json` 与 `public/status.json` 一起提交；合并到 `main` 后 Raw 地址随之更新。CI 另外生成预览附件，不自动提交重建结果、不修改 App 设置。
4. 上游临时失败时构建失败并保留上次完整产物；不会偷偷减少插件或改用未经审核版本。
5. 下架时同时从 `sources.json` 与 `curation.json` 移除并写入 `withdrawn.json`，重新生成；若清单仍包含下架条目，CI 拒绝构建。已发布旧源仍可能保留该版本，更新 Raw 产物时需完成替换和缓存验证。下架不会自动卸载用户已有插件。

CI 会先检查提交中的 `public/`，再重新生成并逐字段比较索引与检查记录；只有构建时间允许不同。如果修改清单或验证记录后忘记提交对应产物，检查会失败。建议通过分支和 PR 等待检查通过后再合并：Raw 的 `main` 地址随合并立即变化，CI 本身不会阻止对 `main` 的直接推送。

每周一 CI 重新核验精确版本，检测失效、撤回和完整性变化；没有自动批准新版本的步骤。生成失败不会覆盖 `public/`，两个产物随同一次 Git 提交更新。回滚时恢复已知有效的 `public/` 文件并提交，不强制改写历史。

## Raw 地址与缓存

`main/public/index.json` 是长期使用的源地址。按提交 SHA 构造的 Raw URL 可用于固定快照复核；日常用户继续使用上面的 `main` 地址。本次 Raw 响应的缓存时长为 300 秒，Harness 成功读取后的默认缓存为 10 分钟，更新不会立即到达所有客户端；需要时在官方市场手动刷新。移除条目不会让历史 Git 快照失效，也不会自动卸载已安装插件。

从测试候选转为正式推荐前，还需真实候选的 Web UI/功能与 macOS 架构验证、回滚演练及网络可达性验证。将来在 Studio 提供添加按钮时，仅通过官方 `setIndexes` 追加并保留其他源，尊重用户删除。

复核公网 Raw 源及本地集成链路：

```sh
DSH_MARKET_SOURCE_URL=https://raw.githubusercontent.com/SteveTanSaMa/DSH-Studio-Plugins/main/public/index.json npm run test:integration
```

## 真实候选复测

```sh
npm run candidates:prepare
npm run candidates:web
```

使用固定的项目内 `TestRuntime/`，保留 Profile、缓存和日志供手动删除。准备命令会重设该测试 Profile 的基础配置；运行前先停止已有测试服务。它通过官方 Plugin Manager 安装两个精确候选且默认停用；启动后可在官方插件页逐一启用、测试。连接信息写入 `TestRuntime/ready.json`，含本机连接令牌，不提交到 Git。

## 保存与恢复索引

```sh
npm run snapshot -- save before-update
# 更新清单、生成产物并验证；需要恢复时：
npm run snapshot -- restore before-update
npm run check
git diff
```

快照位于 `TestRuntime/snapshots/`。恢复会合并版本验证记录并重新生成验证说明，同时保留当前下架记录；若旧快照包含已下架条目，会拒绝恢复。撤回全部候选时可明确设置空清单，并发布空索引。更新、下架与恢复均通过正常 Git 提交更新 Raw 地址。
