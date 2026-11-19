/* 运行配置（可安全公开：这里不放大任何密钥）
 *
 * recipients      最终收件的邮箱列表，页面上会展示
 * submitEndpoint  发信后端地址；留空时"提交并发送"会改为打开本机邮件客户端
 * autoSubmit      配了后端时，候选人到达提交页后自动发送一次（只发一次）
 *
 * 后端负责真正的投递，收件人应写在服务端环境变量里；前端不要放 SMTP 密码或 API Key。 */
window.APP_CONFIG = {
  recipients: ['2360618616@qq.com'],
  submitEndpoint: 'https://1536745519-f48wlsme6t.ap-guangzhou.tencentscf.com',
  autoSubmit: true,
  allowDemo: false,
  draftStorage: 'session',
  maxIntroChars: 3000,
  maxShortChars: 600
};
