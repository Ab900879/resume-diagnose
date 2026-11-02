/* 云服务公共配置（endpoint / publishableKey 可以安全放在前端，这是官方允许的）
 * 真正的密钥在服务端，前端拿不到。
 * 注意：云服务校验请求的 Origin，所以这个页面必须从它自己的域名打开才生效。
 */
window.RD_CLOUD = {
  enabled: true,
  endpoint: "https://resume-diagnose.app.workbuddy.host",
  publishableKey: "wbpk_DEMWtyMX0lLWQwgSLHruaq_mkzyD5VF661iQtIfHajmfG3aAefudnA8",
  dailyLimit: 20
};
