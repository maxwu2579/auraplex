# WhatsApp Business 集成

本服务用于 Auraplex / Huly 的 WhatsApp Business 集成。

## 当前进度

第 1 步提供集成卡片、连接与断开、消息模型和健康检查。当前连接仅表示参数已保存，不会检查真实账号，也不会收发消息。

第 2 步增加本地 Graph API 和 webhook 模拟器。第 3 步增加回复和消息状态，第 4 步增加模板和 24 小时规则。

## 本地试用第 1 步

1. 打开 http://huly.local:8087 并进入已有工作区。
2. 设置 → 集成 → WhatsApp Business → 连接。
3. 公司号码编号填写 100001，商业账户编号填写 200001。
4. 访问令牌填写 local-test-token（只用于本地测试）。
5. 点击连接，卡片显示号码编号及“令牌已保存在服务器”。
6. 点击配置，可查看消息回调地址。令牌框为空，留空保存会保留原令牌。
7. 点击断开，会一起删除连接记录及其服务器端密钥。

这些编号和令牌只用于本地测试。

## 安全和运行方式

- 浏览器提交前使用 RSA-OAEP-SHA256 + AES-256-GCM 加密访问令牌。表单提交的请求只带密文。
- 私钥只在服务进程内存，公钥挑战绑定当前账号和工作区，五分钟后失效且只能使用一次。
- 在本地 HTTP 域名也使用系统随机数。正式环境仍需 HTTPS，以保护登录凭证和防止公钥被替换。
- 输入令牌时，它会暂时存在密码输入框及加密函数内存。提交后清空。服务器不会把保存的令牌返回浏览器，不写前端缓存，也不写日志。
- 访问令牌放在账号服务的 integration secret，普通集成记录只有 phoneNumberId 和 wabaId。
- 只有工作区所有者、管理员或维护者可以配置。一个工作区只允许一个号码，同一号码不能重复连接不同工作区。
- 第 1 步运行单个 WhatsApp 服务实例，通过串行写入避免本进程内的并发重复连接。多实例运行需要增加数据库唯一约束或分布式锁。
- 健康检查为 GET /health。返回 {"status":"ok"} 表示服务已启动。
- 联系人原有 WhatsApp ChannelProvider 在第 1 步保持原有定义，接入对话界面时再迁移并验证旧号码。

## 配置

| 环境变量 | 用途 |
|---|---|
| ACCOUNTS_URL | 账号服务内部地址 |
| SECRET | Huly 服务认证密钥，从部署环境注入 |
| PORT | 本服务端口，默认 8098 |
| WHATSAPP_PUBLIC_URL | 浏览器可以访问的本服务地址，回调地址在其后加 /webhook |
| WHATSAPP_ALLOWED_ORIGINS | 允许的网页来源，以英文逗号分隔 |
| WHATSAPP_GRAPH_URL | Graph API 地址，默认 https://graph.facebook.com，本地配置指向模拟器 |
| WHATSAPP_GRAPH_VERSION | 必填，本地填 mock，正式环境按照接入时 Meta 官方文档选择受支持的版本 |
| WHATSAPP_APP_SECRET | 后续用于 webhook 签名校验，只放在服务器环境 |
| WHATSAPP_VERIFY_TOKEN | 后续用于 webhook 验证，只放在服务器环境 |
| QUEUE_CONFIG | 后续用于监听待发送消息 |

本地 Docker Compose 已设置 Graph API 指向本机模拟器地址。第 1 步尚不发出 Graph API 请求。

## 换成真实账号时

这次只做本地开发。完成第 2～4 步且拥有真实账号后，需要再执行独立的第 5 步验收。

1. 准备 Meta App、WhatsApp Business 账户和业务号码，取得 Phone Number ID、WABA ID、服务端访问令牌。
2. 为 Huly 和 WhatsApp 服务配置可访问的 HTTPS 域名，并更新 WHATSAPP_PUBLIC_URL 和 WHATSAPP_ALLOWED_ORIGINS。
3. 将 WHATSAPP_GRAPH_URL 改为 Meta 官方 Graph 地址，把 WHATSAPP_GRAPH_VERSION 设为当时支持的版本。代码不固定真实版本号。
4. 在服务器安全地配置 WHATSAPP_APP_SECRET、WHATSAPP_VERIFY_TOKEN。保持 SECRET 与现有 Huly 部署一致。
5. 在集成页使用真实编号和令牌重新连接。到 Meta 后台填入界面显示的 webhook 地址及相同的验证令牌，并配置消息订阅。
6. 先用 Meta 测试号码验证收发、状态和模板。正式启用前另行检查权限、模板、客户许可、最新费率、备份及监控。
