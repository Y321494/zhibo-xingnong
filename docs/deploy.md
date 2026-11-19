# 部署到公网：GitHub Pages（页面）+ 腾讯云函数（发信）

目标：

- 页面：`https://<用户名>.github.io/<仓库名>/`
- 发信：腾讯云函数公网地址，形如 `https://xxxx.ap-guangzhou.tencentscf.com`

两条链路都打通后，任何人打开页面提交，报名邮件会直接进 `MAIL_TO` 指定的邮箱。

---

## 一、把代码推到 GitHub

仓库已经在本机初始化并提交（`E:\claude\sanchuang-recruit\.git`），只差一个远端：

```powershell
cd E:\claude\sanchuang-recruit
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 如果还没有仓库：GitHub → New repository → 名字随意（如 `zhibo-xingnong`）→ 不要勾选 README → 创建。
> `server/.env`（含授权码）已在 `.gitignore` 里，不会被推上去。

## 二、开启 GitHub Pages

仓库 → **Settings → Pages**

- Source：`Deploy from a branch`
- Branch：`main`，目录 `/ (root)`
- Save

约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

此时页面能打开，但**点「提交并发送」会提示没连上发信服务**——正常，因为还没部署函数（下一步）。

## 三、部署腾讯云函数

1. 控制台 → **云函数 SCF** → 新建 → 从头创建：
   - 函数名称：`send-mail`
   - 地域：广州（离你最近）
   - 运行环境：**Python 3.9**
   - 提交方法：**上传代码包** → 选 `deploy/scf-send.zip`
   - 执行方法：`scf_handler.main_handler`
   - 超时时间：`10` 秒

2. 函数配置 → **环境变量**（四个必填）：

   | 变量 | 值 |
   |---|---|
   | `MAIL_TO` | `2360618616@qq.com` |
   | `SMTP_USER` | `yuyangzhe3_0807@qq.com` |
   | `SMTP_PASS` | 你的 QQ 邮箱授权码 |
   | `SMTP_HOST` | `smtp.qq.com` |
   | `SMTP_PORT` | `465` |

3. **触发器** → 新建 API 网关触发器：

   - 请求方法：`ANY`（或 `POST` + `OPTIONS`）
   - 若控制台有「支持 CORS」选项，勾上
   - 记录生成的公网地址（形如 `https://xxxx.ap-guangzhou.tencentscf.com`）

4. 先在本地验证一次（换成你的函数地址）：

   ```bash
   curl -X POST "https://xxxx.ap-guangzhou.tencentscf.com" \
     -H "Content-Type: application/json" \
     -d "{\"subject\":\"测试\",\"text\":\"函数发信测试\"}"
   ```

   期望返回 `{"ok": true, "dryRun": false, "to": ["2360618616@qq.com"], ...}`。
   若返回 `dryRun: true`，说明 `SMTP_PASS` 没配到环境变量里。

## 四、把页面接到函数

编辑 `assets/config.js`：

```js
submitEndpoint: 'https://xxxx.ap-guangzhou.tencentscf.com',
```

提交并推送：

```powershell
git add assets/config.js
git commit -m "point submit endpoint to scf"
git push
```

等 Pages 更新（约 1 分钟，或 `Ctrl+F5` 强刷）。再打开页面走完五步，最后一步应显示「✅ 已自动发送」。

## 五、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 页面提示「没有连上发信服务」 | `submitEndpoint` 还是空的或地址写错；也可能是 API 网关没开 CORS |
| 浏览器控制台报 CORS | 在 API 网关触发器上开启 CORS；函数本身已返回 `Access-Control-Allow-Origin: *` |
| 返回 `dryRun: true` | 函数环境变量缺 `SMTP_PASS` |
| 返回 500 且 error 含 `535` | 授权码不对或该邮箱未开启 SMTP 服务 |
| 收不到邮件 | 查垃圾箱；把 `yuyangzhe3_0807@qq.com` 加入白名单 |
| 想换收件人 | 改函数环境变量 `MAIL_TO`，不用动前端 |

## 六、安全提醒

- 授权码**只放云函数环境变量**，永远不要写进 `assets/config.js` 或仓库；
- 云函数版目前没有频率限制，建议在 API 网关设置 **QPS 限流 / 每日配额**，防止被人刷接口；
- 页面是公开的，任何拿到链接的人都能提交；收件人由服务端决定，前端改不了。
