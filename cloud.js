/* 免 Key 模式：走 WorkBuddy 云服务的 keyless LLM，费用记在作者账号上
 * SDK 由 cloud-service 文档指定从 jsdelivr 加载；本机实测 jsdelivr 连不上，
 * 所以加了 unpkg 兜底，两个都失败才报错。
 */
(function () {
  const SDKS = [
    "https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js",
    "https://unpkg.com/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"
  ];

  let sdkPromise = null;
  let client = null;
  let modelId = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("load fail"));
      document.head.appendChild(s);
    });
  }

  async function ensureSdk() {
    if (window.WorkBuddyCloud) return window.WorkBuddyCloud;
    if (!sdkPromise) {
      sdkPromise = (async () => {
        for (const url of SDKS) {
          try {
            await loadScript(url);
            if (window.WorkBuddyCloud) return window.WorkBuddyCloud;
          } catch (e) { /* 试下一个源 */ }
        }
        throw new Error("MODEL_SDK_DOWN");
      })();
    }
    return sdkPromise;
  }

  function cfg() {
    return window.RD_CLOUD || { enabled: false };
  }

  async function ensureClient() {
    const c = cfg();
    if (!c.enabled || !c.endpoint || !c.publishableKey) throw new Error("MODEL_NO_CONFIG");
    const SDK = await ensureSdk();
    if (!client) {
      client = SDK.createWorkBuddyCloud({
        endpoint: c.endpoint,
        publishableKey: c.publishableKey
      });
    }
    return client;
  }

  async function ensureModel(cl) {
    if (modelId) return modelId;
    const list = await cl.llm.models.list();
    const arr = (list && (list.data || list.models || list)) || [];
    const arr2 = Array.isArray(arr) ? arr : [];
    const m = arr2.find(x => x && x.disabled !== true);
    if (!m || !m.id) throw new Error("MODEL_NONE");
    modelId = m.id;
    return modelId;
  }

  const SYS = "你是简历事实整理与诊断助手。只使用输入里出现的信息，不编造、不升级动词，输出严格 JSON。";

  async function chat(userContent) {
    const cl = await ensureClient();
    const model = await ensureModel(cl);
    let text = "";
    const stream = await cl.llm.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: userContent }
      ],
      stream: true,
      response_format: { type: "json_object" },
      temperature: 0.2
    });
    for await (const chunk of stream) {
      const d = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (d && d.content) text += d.content;
    }
    if (!text) throw new Error("MODEL_EMPTY");
    return text;
  }

  function explain(e) {
    const code = (e && e.error && e.error.code) || "";
    const id = (e && e.requestId) ? "（请求号 " + e.requestId + "）" : "";
    if (code.indexOf("auth_") === 0)
      return "云服务没通过校验：这个页面只能从作者自己的域名打开，换地址就不行。" + id;
    if (code.indexOf("quota_") === 0)
      return "作者的额度用完了或被限流了。等一会儿再试，或者填你自己的 Key。";
    if (code.indexOf("request_") === 0)
      return "参数或模型不匹配：" + ((e && e.error && e.error.message) || "") + id;
    if (code.indexOf("gateway_") === 0 || code.indexOf("model_") === 0)
      return "模型服务暂时不可用，重试一次。" + id;
    if (code.indexOf("internal_") === 0)
      return "服务内部错误。" + id;
    const m = String((e && e.message) || e || "");
    if (m === "MODEL_SDK_DOWN") return "识别组件没加载上来（两个 CDN 都连不上），先填自己的 Key 用。";
    if (m === "MODEL_NO_CONFIG") return "云服务还没配置好，先填自己的 Key 用。";
    if (m === "MODEL_NONE") return "没有可用的模型，先填自己的 Key 用。";
    if (m === "MODEL_EMPTY") return "模型返回了空内容，重试一次。";
    return "调用失败：" + m.slice(0, 160) + id;
  }

  window.RD_CLOUD_API = { chat: chat, explain: explain, isOn: () => !!cfg().enabled };
})();
