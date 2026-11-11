# WhatsApp Business 集成

本服务用于 Auraplex / Huly 的 WhatsApp Business 集成。

## 当前进度

第 1～4 步已完成：连接管理、接收、回复、消息状态、24 小时窗口和模板消息。现在可以用本地模拟器发送客户消息，自动匹配或创建联系人，并通知连接者和关注该联系人的同事。

联系人下面的 WhatsApp 消息窗口支持文字回复。客户最后一条消息超过 24 小时（或客户从没发过消息）时，只能选择已审核的模板发送。第 5 步（接真实 Meta）等有账号后再做。

## 本地试用第 1 步

1. 打开 http://huly.local:8087 并进入已有工作区。
2. 设置 → 集成 → WhatsApp Business → 连接。
3. 公司号码编号填写 100001，商业账户编号填写 200001。
4. 访问令牌填写 local-test-token（只用于本地测试）。
5. 点击连接，卡片显示号码编号及“令牌已保存在服务器”。
6. 点击配置，可查看消息回调地址。令牌框为空，留空保存会保留原令牌。
7. 点击断开，会一起删除连接记录及其服务器端密钥。

这些编号和令牌只用于本地测试。

## 本地试用第 2 步

以下操作全部在本机完成。使用本机 Node.js、Docker Desktop，保持 Huly 已启动。

第一次准备模拟器配置，在 PowerShell 运行下面两行。已经有配置时会保留现有配置。

```powershell
cd "C:\Auraplex app\platform"
node services/whatsapp/mock/index.mjs setup --token local-test-token
```

local-test-token 只用于本地测试。签名密钥和验证令牌由工具随机生成，写到 dev/.env.whatsapp.local。此文件已加入忽略规则，不提交。集成页的访问令牌应与该文件的 WHATSAPP_MOCK_TOKEN 相同。

一条命令启动本地 Graph 模拟器和 WhatsApp 服务。

```powershell
docker compose --project-directory dev -f dev/docker-compose.yaml -f dev/docker-compose.min.yaml -f services/whatsapp/mock/compose.mock.yaml up -d whatsapp-mock whatsapp
```

然后打开 Huly → 设置 → 集成。如果还没连接，填写 Phone Number ID 为 100001，WABA ID 为 200001，访问令牌为 local-test-token（只用于本地测试）。

模拟一个客户发来消息，运行下面这一行。

```powershell
node services/whatsapp/mock/index.mjs send --phone 6588880002 --name "测试客户" --text "你好，我想了解产品"
```

看到“已提交本地模拟消息”以后，等待几秒，可以用以下两种方式查看：

1. 左侧 Inbox（收件箱）→ 点击通知分组标题 WhatsApp / 6588880002，直接打开会话。点击下面的“New WhatsApp message”文字会先打开客户资料。
2. 左侧 Contacts（联系人）→ Person → 找到“测试客户”→ 点击 WhatsApp 图标 → 在号码旁点右箭头，即可打开消息窗口。也可以先打开客户资料，再用相同方式打开。

每次运行 send 且不指定 --id，都会产生一条新的测试消息。

找不到号码会自动新建联系人。已有号码即使带 +、空格、括号或横线，也会对应到原联系人，保持原来的号码值和姓名。没有客户昵称时用号码命名。

通知默认发给连接集成的人，以及关注了该联系人的同事。同一个人只通知一次，用户关闭对应站内通知后会遵从该设置。打开 WhatsApp 会话时会把该会话的通知标为已读。

### 验证重复推送、错误签名和不支持类型

```powershell
node services/whatsapp/mock/index.mjs send --phone 6588880002 --name "测试客户" --text "重复推送测试" --id wamid.local-repeat --repeat 2
node services/whatsapp/mock/index.mjs send --phone 6588880002 --name "测试客户" --text "错误签名测试" --bad-signature
node services/whatsapp/mock/index.mjs send --phone 6588880002 --name "测试客户" --text "图片占位测试" --type image
```

第一行推送两次，只应存一条消息。第二行应返回 HTTP 401，Huly 中不会出现。第三行会显示“不支持的消息类型”占位。

可选参数包括 --phone-number-id、--waba-id、--webhook、--id、--timestamp（秒）。测试其他公司号码时，必须先在对应工作区配置匹配的 Phone Number ID。模拟器仅允许向本机或本地 Docker 服务推送。

## 本地试用第 3 步

先按第 2 步启动模拟器并保持连接。进入 Contacts → Person → 测试客户，点击 WhatsApp 图标，再点击号码右侧箭头。也可以从 Inbox 点击 WhatsApp / 号码分组标题打开。

在窗口底部“Reply to customer / 回复客户”输入文字，点击“Send / 发送”。发出的消息显示在右侧，状态从 Pending / 待发送、Sending / 发送中更新为 Sent / 已发送，约 1.5 秒后变为 Delivered / 已送达，约 3 秒后变为 Read / 已读。

PowerShell 在仓库根目录运行下面命令，查看模拟器实际收到的回复号码、内容及消息编号。

```powershell
node services/whatsapp/mock/index.mjs received
```

模拟器只保留最近 1000 条成功接收的请求供查看，重启模拟器后清空。Huly 里的消息继续保存在数据库。

测试失败提示，先运行下面命令，再回到 Huly 发送一条文字。

```powershell
node services/whatsapp/mock/index.mjs error --mode token
```

该消息应显示 Failed / 发送失败，以及“访问令牌无效或已过期”的中文原因和错误码 190。测试后恢复正常，再发一条新的文字。

```powershell
node services/whatsapp/mock/index.mjs error --mode none
```

队列重复通知不会重复发送同一条消息。服务重启后会检查待发送记录，继续处理。发送中断超过两分钟、请求超时或确认响应丢失时，显示无法确认结果的失败提示，需先核实客户是否收到，再决定是否新发一条。为避免客户收到重复内容，这类消息不会自动重发。

普通成员可以读取不含密钥的连接状态并回复。连接参数和令牌仍由管理员配置。

## 本地试用第 4 步

24 小时以“客户最后一条发来的消息”计算，我们自己发出的消息不算。客户从没发过消息时，也只能发模板。

1. 用模拟器发一条“25 小时前”的客户消息。要用一个新号码，因为老号码已经有最近的消息，窗口还开着：

```powershell
node services/whatsapp/mock/index.mjs send --phone 6588880009 --name "老客户" --text "上次问过的产品" --hours-ago 25
```

2. 在 Huly 打开这个联系人的 WhatsApp 窗口。底部不再是输入框，而是提示“已超过 24 小时，只能发送已审核的模板消息”和模板选择。
3. 选择 product_followup_zh，填写“变量 1”和“变量 2”，下面会显示预览。点击发送。消息上方显示“模板 · product_followup_zh”，状态同样更新到已读。
4. 运行 `node services/whatsapp/mock/index.mjs received`，能看到 type 为 template、模板名和填写的变量。
5. 再用这个号码发一条普通消息（不带 --hours-ago），窗口重新打开，底部恢复成普通输入框。

测试窗口错误提示（模拟 Meta 那边认为已超时）：

```powershell
node services/whatsapp/mock/index.mjs error --mode window
```

然后在窗口还开着的联系人里发一条普通文字，应显示发送失败、“超过 24 小时回复窗口，请使用已审核的模板消息”和错误码 131047。模板消息不受影响。测试后运行 `error --mode none` 恢复。

模拟器的模板列表里有 5 个模板：3 个可以发送；1 个还在审核（PENDING），1 个标题里有变量。后两个不会出现在 Huly 的模板选择里，因为这一版只支持正文变量（{{1}}、{{2}}…），不支持标题变量、按钮变量、图片标题和命名变量。

需要临时缩短窗口做测试时，可以给 whatsapp 服务加环境变量 WHATSAPP_REPLY_WINDOW_MINUTES（例如 2，表示 2 分钟）。不设就是 24 小时。正式环境不要设置。界面提示文字仍写“24 小时”。

### Graph 模拟器

本地 Graph 接口使用 mock 版本路径，提供 POST /mock/{phone_number_id}/messages 和 GET /mock/{waba_id}/message_templates。返回假的消息编号，约 1.5 秒后推送 delivered，3 秒后推送 read，所有回调带签名。包含中文和英文已审核模板、一个未审核模板和一个带标题变量的模板。发送模板时，模拟器像 Meta 一样检查模板名、语言（132001）和变量数量（132000）。

切换模拟错误，供第 3、4 步验证。

```powershell
node services/whatsapp/mock/index.mjs error --mode token
node services/whatsapp/mock/index.mjs error --mode window
node services/whatsapp/mock/index.mjs error --mode none
```

分别表示令牌错误、普通文字超出窗口错误、恢复正常。也可以不用 Docker，前台运行 node services/whatsapp/mock/index.mjs start 启动纯 Node 模拟器。Docker 中的 Huly 服务应使用 compose.mock.yaml 提供的内部地址。

模拟器自测命令为 node --test services/whatsapp/mock/mock.test.mjs。

## 安全和运行方式

- 浏览器提交前使用 RSA-OAEP-SHA256 + AES-256-GCM 加密访问令牌。表单提交的请求只带密文。
- 私钥只在服务进程内存，公钥挑战绑定当前账号和工作区，五分钟后失效且只能使用一次。
- 在本地 HTTP 域名也使用系统随机数。正式环境仍需 HTTPS，以保护登录凭证和防止公钥被替换。
- 输入令牌时，它会暂时存在密码输入框及加密函数内存。提交后清空。服务器不会把保存的令牌返回浏览器，不写前端缓存，也不写日志。
- 访问令牌放在账号服务的 integration secret，普通集成记录只有 phoneNumberId 和 wabaId。
- 只有工作区所有者、管理员或维护者可以配置。一个工作区只允许一个号码，同一号码不能重复连接不同工作区。
- 第 1 步运行单个 WhatsApp 服务实例，通过串行写入避免本进程内的并发重复连接。多实例运行需要增加数据库唯一约束或分布式锁。
- 健康检查为 GET /health。返回 {"status":"ok"} 表示服务已启动。
- WhatsApp ChannelProvider 已移到 models/whatsapp，保留原编号。旧 Channel 数据沿用原号码和原联系人。
- 每次推送先对原始请求体校验 HMAC-SHA256 签名。错误签名返回 401。验证回调要求 subscribe 模式和匹配的验证令牌。
- 返回 200 前，推送先写入 whatsapp_events 数据卷。后台写入 Huly，失败最多尝试 5 次，间隔通常为 5 秒。尝试次数保存在文件名中，重启后继续累计。达到上限后移入 /var/lib/whatsapp/inbox/failed，保留内容并记录一次文件名，不再自动重试。损坏的文件也按相同规则隔离，其他推送继续处理。消息、联系人、通知用同一批操作提交，消息使用按公司号码和 wamid 生成的固定编号，重复推送不会重复入库。
- 排查失败推送可运行 docker exec dev-whatsapp-1 ls /var/lib/whatsapp/inbox/failed。修复工作区等原因后，管理员可以把选定的文件复制回 inbox 根目录以重新尝试，并保留 failed 原件；不要直接清空文件夹。
- 待处理推送属于临时传输记录，成功后清理对应文件。业务数据始终在 Huly 数据模型中。备份时保留该数据卷可避免丢失尚未完成的推送。

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
| WHATSAPP_APP_SECRET | webhook 签名校验，只放在服务器环境 |
| WHATSAPP_VERIFY_TOKEN | webhook 验证，只放在服务器环境 |
| WHATSAPP_REPLY_WINDOW_MINUTES | 只用于本地测试：缩短 24 小时窗口，单位分钟，最大 1440。正式环境不要设置 |
| WHATSAPP_INBOX_DIR | 待处理推送目录，默认 /var/lib/whatsapp/inbox |
| QUEUE_CONFIG | 监听 Huly 的 QueueTopic.Tx，处理待发送消息 |
| REGION | 队列区域，必须与工作区 transactor 一致；本机为 cockroach |

使用 compose.mock.yaml 时 Graph API 指向本地 whatsapp-mock 容器，接收 Huly 的回复并推送状态。

## 换成真实账号时

这次只做本地开发。第 1～4 步已完成，拥有真实账号后，需要再执行独立的第 5 步验收。

1. 准备 Meta App、WhatsApp Business 账户和业务号码，取得 Phone Number ID、WABA ID、服务端访问令牌。
2. 为 Huly 和 WhatsApp 服务配置可访问的 HTTPS 域名，并更新 WHATSAPP_PUBLIC_URL 和 WHATSAPP_ALLOWED_ORIGINS。
3. 将 WHATSAPP_GRAPH_URL 改为 Meta 官方 Graph 地址，把 WHATSAPP_GRAPH_VERSION 设为当时支持的版本。代码不固定真实版本号。
4. 在服务器安全地配置 WHATSAPP_APP_SECRET、WHATSAPP_VERIFY_TOKEN。保持 SECRET 与现有 Huly 部署一致。
5. 在集成页使用真实编号和令牌重新连接。到 Meta 后台填入界面显示的 webhook 地址及相同的验证令牌，并配置消息订阅。
6. 在 Meta 的 WhatsApp 管理工具里建模板并等审核通过。这一版只能发送“正文变量”的模板，模板标题、按钮里不要放变量，也不要用图片标题。
7. 先用 Meta 测试号码验证收发、状态和模板。正式启用前另行检查权限、模板、客户许可、最新费率、备份及监控。
