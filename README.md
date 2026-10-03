# Clawd Watch Approval

用 Apple Watch 查看并批准 AI coding agent 的操作。Mac 上的 Clawd on Desk 统一接收审批请求，手表通过 HTTPS 直接读取详情并回传“允许一次”或“拒绝”。后台提醒使用 Apple Watch APNs，无需 Pushcut。

Standalone Apple Watch approvals for Codex, Claude Code, DeepSeek Harness and Kimi through Clawd on Desk. Direct HTTPS, device pairing, APNs alerts and interactive notification controls.

![通知内审批按钮](docs/notification-preview.png)

## 功能

- Codex、Claude Code、DeepSeek Harness（DSH）、Kimi 审批接入。
- Watch-only App；联网后直接连接 Mac，不依赖 iPhone 作为审批中继。
- App 内审批详情可滚动，允许和拒绝圆按钮固定在底部。
- 抬腕通知可以直接显示详情和审批按钮。系统通知及专注模式设置会影响展示。
- 每台设备独立配对凭据，手表凭据保存在 Keychain；请求有版本和过期时间。
- 决定有 operation ID 和交付回执；响应丢失后查询同一决定，避免重复提交。
- 推送仅带通用提示、请求 ID 和版本；命令详情通过鉴权连接读取。

```mermaid
flowchart LR
    Agents[Codex / Claude / DSH / Kimi] --> Desktop[Clawd on Desk 审批队列]
    Desktop --> Gateway[鉴权 HTTPS 网关]
    Gateway <--> Watch[Apple Watch]
    Desktop --> APNs[Apple APNs]
    APNs --> Watch
```

## 快速开始

需要 macOS、Node.js、Python 3、Git、支持 watchOS 10+ 的 Xcode 和 Apple Watch。实机后台 APNs 需要自己的 Apple Developer 团队、App ID、推送权限和签名配置。此仓库提供源码，没有预签名安装包。

### 1. 准备兼容的桌宠源码

补丁基于 Clawd on Desk 的固定提交；安装器会逐文件核对原始 SHA-256，遇到已有修改或版本不匹配会停止。请先用独立副本验证。

```sh
git clone https://github.com/moonlin1213/clawd-watch-approval.git
cd clawd-watch-approval
git clone https://github.com/rullerzhou-afk/clawd-on-desk.git build/clawd-on-desk
git -C build/clawd-on-desk checkout bf834e7d1f49eb9913702cd38db62bbf8fba8f00
python3 scripts/install-local-patch.py --target build/clawd-on-desk --check
python3 scripts/install-local-patch.py --target build/clawd-on-desk --apply --backup build/desktop-backup
```

桌宠的图像和主题素材从原项目获取，本仓库只提供源码补丁。补丁也包含本版本所需的 DSH/Kimi 接入及回归测试。

```sh
cd build/clawd-on-desk
npm ci
npm start
```

进入桌宠设置的“手表审批”，配置自己的 HTTPS 地址并开启服务。网关默认监听 `127.0.0.1:23940`，前缀为 `/api/clawd-watch/v1`。

### 2. 提供 HTTPS 网络入口

可以使用 Tailscale Funnel 或自己的 HTTPS 反向代理。只代理审批网关，不要公开桌宠的 hook 或管理服务。

```sh
bash scripts/configure-clawd-watch-funnel.sh --port 23940
# 阅读预览和已有 Funnel 配置后应用单一路径：
bash scripts/configure-clawd-watch-funnel.sh --apply --port 23940
bash scripts/verify-clawd-watch-boundary.sh https://YOUR-HOST.example
```

如果 Tailscale CLI 不在默认路径，设置 `CLAWD_TAILSCALE_BIN`。脚本不会 reset 已有 Funnel；同路径已有映射时请先核对目标。

### 3. 配置并安装 Watch App

打开 `watch/ClaudeWatch.xcodeproj`，选择 **ClaudeWatchWatch** scheme。此 scheme 是独立 Watch App；保留的上游 iOS 文件不是当前审批中继。

- 在 Watch target 的 Signing & Capabilities 选择自己的开发者团队。
- 将示例 bundle ID `org.example.clawdwatch.watchapp` 改为自己注册的专用 App ID，并开启 Push Notifications。
- 同步修改 `desktop-patch/src/watch-approval-apns.js` 的 `TOPIC`、示例 APNs 配置的 `topic`，以及对应测试中的示例 topic。若已经应用桌宠补丁，也同步修改实际桌宠副本中的该文件。
- `Info.plist` 的审批地址默认留空。可以在手表配对页输入完整地址，例如 `https://YOUR-HOST.example/api/clawd-watch/v1`；也可以自行设置 `ClawdApprovalGatewayURL`。
- 构建安装到自己的手表，然后用桌宠生成的六位临时码配对。

个人团队、服务器地址及签名配置只应保留在自己的本地副本。

### 4. 配置后台提醒

参考 [APNs 配置示例](examples/apns-config.example.json)。Mac 上配置文件的位置是 Electron userData 下的 `watch-approval/apns-config.json`；macOS 通常是 `~/Library/Application Support/clawd-on-desk/watch-approval/apns-config.json`。

用自己的 team ID、key ID、App ID 填写配置，`privateKeyPath` 只引用 Mac 上的 APNs `.p8` 原文件。保护该目录及文件权限（目录 `0700`、配置和密钥 `0600`），重启桌宠以加载配置。不要把私钥放进仓库、App 或手表。

当前 entitlement 示例为开发环境，开发签名注册 sandbox token。App 从签名 profile 读取实际推送环境；生产发布需要相应的生产签名及可用的 APNs 密钥配置。

允许 Clawd Watch 通知，并将它加入当前专注模式的允许列表。要抬腕显示完整通知，关闭系统“轻点显示完整通知”。Mac 必须持续运行且网络入口可达。

## 验证与当前范围

```sh
npm test
swift test --package-path watch/Packages/ClawdWatchCore --scratch-path build/swift-tests
xcodebuild -project watch/ClaudeWatch.xcodeproj -scheme ClaudeWatchWatch -sdk watchsimulator -destination 'generic/platform=watchOS Simulator' -derivedDataPath build/watch-simulator CODE_SIGNING_ALLOWED=NO build
cd build/clawd-on-desk
npm test
```

已在 Apple Watch 实机验证配对、Codex 审批回执、抬腕显示审批按钮和配色；真实 Claude 单次 Bash 测试也成功执行。四种 agent 的完整允许/拒绝矩阵、通知内长内容滚动及手机关闭后的纯蜂窝全过程仍需分别验收。模拟器截图使用离线样例，不包含真实审批内容。

## 隐私与安全

公开仓库没有运行配置、APNs 密钥、签名证书/profile、设备 token、配对凭据、用户日志或原本地开发历史。开发者团队和服务器地址均为空或示例值。详细边界与报告方式见 [SECURITY.md](SECURITY.md)。

## 上游与许可证

- 桌宠补丁基于 [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)，源码使用 **AGPL-3.0-only**，保留于 [LICENSE](LICENSE)。桌宠素材不在本仓库内，原项目的素材授权不由本仓库重新授予。
- Watch 界面基于 [shobhit99/claude-watch](https://github.com/shobhit99/claude-watch) 的 `037e8b4d5a00e7ebcbfceb03fdd385825fab7fa0`。上游 README 声明 **MIT**；授权及归属见 [watch/LICENSE](watch/LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 本仓库新的桌宠接入代码与工具使用 AGPL-3.0-only；Watch 部分使用 MIT。项目不隶属于或代表相关 agent、Apple、Anthropic、OpenAI 或 Tailscale。
