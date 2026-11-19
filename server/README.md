# 发信后端（让「提交并发送」真的自动发邮件）

静态页面本身发不了邮件（浏览器不能连 SMTP，也不该把密码放前端）。这里给一个**零依赖**的 Python 后端，两种用法：

- `send_server.py`：本机/局域网用，同时托管页面和 `/api/send`；
- `scf_handler.py`：部署到腾讯云函数（和你之前用的一样），只做发信接口。

## 收件人

默认已配置为：

```
2360618616@qq.com
yuyangzhe3_0807@qq.com
```

想改就设环境变量 `MAIL_TO`（逗号分隔）。**收件人写在服务端**，前端传来的 `recipients` 会被忽略——避免别人改页面就把垃圾邮件塞给别人。

## 快速验证（不真的发信）

```powershell
cd E:\claude\sanchuang-recruit
python server\send_server.py
# 另开一个终端
curl -X POST http://127.0.0.1:8125/api/send -H "Content-Type: application/json" -d "{\"subject\":\"测试\",\"text\":\"hello\"}"
```

未配置 `SMTP_PASS` 时是 **dry-run**：不投递，把内容写到 `server/outbox/`，控制台打印摘要，返回 `{"ok":true,"dryRun":true}`。

## 真正发信

1. 准备一个发件邮箱（建议新注册一个 QQ 邮箱当机器人，别用私人主号）。
2. QQ 邮箱 → 设置 → 账户 → 开启 `POP3/SMTP 服务` → 生成 **授权码**（不是登录密码）。
3. 编辑 `server/.env`（已生成，已在 `.gitignore` 里）：

```
SMTP_USER=机器人邮箱@qq.com
SMTP_PASS=授权码
MAIL_TO=2360618616@qq.com,yuyangzhe3_0807@qq.com
```

4. 重启 `python server\send_server.py`，控制台会显示「发信模式：真实发信」。
5. 打开 `http://127.0.0.1:8125/`，走到最后一步——页面会自动投递到收件邮箱。

## 部署到腾讯云函数

1. 新建 Python 3.9 函数，上传 `server/` 目录（`mailer.py` + `scf_handler.py`）。
2. 环境变量同上（`MAIL_TO`、`SMTP_USER`、`SMTP_PASS`）。
3. 开启「API 网关触发器」，拿到公网地址，例如 `https://xxxx.ap-guangzhou.tencentscf.com`。
4. 把地址填进 `assets/config.js` 的 `submitEndpoint`，刷新页面即可自动发送。

## 安全要点

- **收件人由服务端决定**，前端只提交内容；
- 有频率限制（每 IP 10 分钟 6 次）与正文长度上限（64 KB 请求、20 KB 正文）；
- SMTP 授权码只放环境变量，**永远不要写进 `config.js`**（上一版就是栽在这）；
- 公网部署建议再加一层：只允许你的 GitHub Pages 域名（`Origin` 白名单）与验证码。
