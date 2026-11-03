# 部署与维护

## 文件

- `movecar.js`：页面、通知请求、车主确认和位置逻辑。
- `build.mjs`：将原 Service Worker 入口适配为 Pages module Worker；环境绑定按请求隔离。
- `notifications.mjs`：推送渠道与服务商返回状态检查。
- `follow-up.mjs`：签名会话、刷新恢复和延迟开放入口。
- `wrangler.example.jsonc`：公开配置模板。复制为被 Git 忽略的 `wrangler.jsonc` 后填写自己的 KV ID。

## Secrets

使用 `wrangler pages secret put NAME --project-name movecar` 交互输入，随后重新部署。不要将真实值写入代码、README 或配置示例。

| 名称 | 用途 |
| --- | --- |
| `PUSHPLUS_TOKEN` | PushPlus 微信渠道 |
| `SERVERCHAN_UID`、`SERVERCHAN_SENDKEY` | Server酱³；两项同时配置 |
| `BARK_URL` | Bark 推送地址 |
| `FOLLOW_UP_SECRET` | 会话签名密钥，至少 32 随机字节 |
| `PHONE_NUMBER` | 一分钟后开放的备用号码，支持数字和开头的 `+` |

多渠道同时配置时，优先级为 Server酱³ → PushPlus → Bark，只选择第一个已配置渠道；并非失败后自动切换。没有任何渠道时，通知接口返回 503。

当前会话签发要求 `FOLLOW_UP_SECRET` 和 `PHONE_NUMBER` 同时存在。省略其中任意一项时不会开放备用电话，但也不会建立用于刷新恢复的会话。

## 构建、测试、部署

```sh
node build.mjs
node --test notifications.test.mjs follow-up.test.mjs session.test.mjs
wrangler pages deploy dist --project-name movecar --branch main
```

测试使用模拟通知服务和虚构号码，不会向真实手机发送消息。

在 Pages 中添加自定义子域名，再在 DNS 服务商处创建 CNAME，目标使用 Cloudflare 为该项目实际分配的 `*.pages.dev` 域名。等待域名验证和 HTTPS 证书激活。NFC 标签和二维码始终使用最终 HTTPS 网址。

## 会话行为

首次通知被推送服务接受后，签发有效期 15 分钟的 HttpOnly / Secure / SameSite Cookie。计时由服务器决定，满 60 秒之前后续内容接口只返回空内容。再次通知保留原会话和截止时间。

页面刷新调用 `/api/session` 恢复当前等待或确认状态，并按已过去的时间安排后续内容更新；满一分钟后刷新会立即尝试获取入口。会话不存在或过期时显示初始页面。恢复需要同一浏览器、同一网址并允许 Cookie。

页面每 3 秒查询车主状态，收到确认后停止；状态接口禁止缓存。KV 的传播延迟可能让不同地区之间的确认更新稍有延迟。
