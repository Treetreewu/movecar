# MoveCar · 挪车通知

基于 [lesnolie/movecar](https://github.com/lesnolie/movecar) 的个人定制 fork。访客扫描二维码或触碰 NFC 标签后，可以留言通知车主，并查看车主确认状态。

使用 Cloudflare Pages Functions（Worker advanced mode）和 KV，通过 Wrangler CLI 部署。保留上游的页面和位置共享功能，补充通知、隐私与刷新恢复逻辑。

## 定制内容

- **多种通知渠道**：支持 PushPlus 微信、Server酱³、Bark；凭证通过 Cloudflare Secrets 配置。检查推送服务返回的业务状态，未配置时不会显示发送成功。
- **延迟开放备用电话**：第一次通知发送成功后，由服务器计时 60 秒；此前页面源码和接口响应不包含号码，也不显示电话按钮、倒计时或电话功能提示。满一分钟后才返回拨号入口。
- **再次通知不重置计时**：同一有效会话内沿用第一次成功发送的时间，已显示的入口也不会被隐藏。
- **刷新恢复**：在同一浏览器、同一网址下，15 分钟内刷新可恢复等待或确认状态，继续查询车主回复；不会自动重新发送通知，也不会重置一分钟计时。
- **会话校验**：签名、HttpOnly、Secure Cookie；提前请求或篡改凭证无法绕过服务器的时间判断。
- **回归测试**：覆盖推送失败、时间边界、凭证篡改、再次通知和刷新恢复。

## 快速开始

需要 Node.js 22+、Wrangler CLI 和 Cloudflare 账号。

```sh
git clone https://github.com/Treetreewu/movecar.git
cd movecar
npm install -g wrangler
wrangler login
wrangler kv namespace create MOVE_CAR_STATUS
```

将 `wrangler.example.jsonc` 复制为 `wrangler.jsonc`，填入刚创建的 KV namespace ID。实际配置文件已被 Git 忽略。

```sh
node build.mjs
node --test notifications.test.mjs follow-up.test.mjs session.test.mjs
wrangler pages project create movecar --production-branch main
```

若 Wrangler 提示新项目被自动转交给 Workers、无法创建 Pages 项目，可按 CLI 提示仅在创建时添加 `--force`。

配置通知和会话凭证，例如使用 PushPlus：

```sh
wrangler pages secret put PUSHPLUS_TOKEN --project-name movecar
wrangler pages secret put FOLLOW_UP_SECRET --project-name movecar
wrangler pages secret put PHONE_NUMBER --project-name movecar
wrangler pages deploy dist --project-name movecar --branch main
```

按提示输入值。`FOLLOW_UP_SECRET` 使用自己生成的随机密钥（至少 32 随机字节），不要提交到 Git。当前实现需要同时配置 `PHONE_NUMBER` 才会建立用于刷新恢复的会话；其他渠道及配置见 [部署说明](DEPLOYMENT.md)。

将部署后的 HTTPS 网址写入 NFC 标签的 URL 类型，或生成二维码。使用第三方 DNS 时，可以绑定子域名并添加指向 Pages 项目域名的 CNAME。

> 本 fork 需要先执行 `node build.mjs`；不要直接把 `movecar.js` 粘贴到 Worker 编辑器。保留的 `preview-*.html` 是上游静态界面预览，不代表本版本完整行为。

## 使用边界

这是个人单车使用版本，仍沿用上游按全局键保存车主状态和位置的方式；多位访客同时操作可能互相影响，车主确认接口也尚未实现独立身份认证。不应当作已完成多租户隔离的公共服务。

满一分钟开放的是普通拨号入口，届时请求方能够获知真实号码，并非隐私号转接。推送成功表示服务商接受了请求，不保证手机通知栏一定提醒。

## License

沿用上游 [MIT License](LICENSE)，感谢原作者 [lesnolie](https://github.com/lesnolie)。
