/* 免 Key 模式：走 WorkBuddy 云服务的 keyless LLM，费用记在作者账号上
 *
 * 【为什么这里要自己挑模型，而不是用默认】
 * 实测（2026-11-02，同一份建库提示词）：
 *   auto              首字 206s，总 210s   —— 它是推理模型且 effort=high，用户等 3 分钟没动静
 *   glm-5.3-flash     首字 1.7s，总 7.4s   —— 不推理，输出结构完整
 *   deepseek-v4.1-f   首字 5.5s，总 7.4s   —— 但第二段出现过整份结构为空的情况
 *   hunyuan-chat      首字 2.7s，总 15.8s
 * 所以：默认模型不能取 models.list() 的第一条，必须按"快且非强制推理"挑，
 * 并且对输出做结构校验，结构不对就换下一个模型重跑。
 *
 * SDK 由 cloud-service 文档指定从 jsdelivr 加载；本机实测 jsdelivr 连不上，
 * 所以加了 unpkg 兜底，两个都失败才报错。
 */
(function () {
  const SDKS = [
    "https://unpkg.com/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js",
    "https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"
  ];

  /* 按实测速度排序。前一个超时或输出结构不对，就换下一个。 */
  const PREFERRED = ["glm-5.3-flash", "deepseek-v4.1-flash", "auto"];
  const TIMEOUT_MS = 30000;   // 单模型单段超时（glm 段2 实测 10~18s，30s 足够；超了就换）
  const SLOW_HINT_MS = 8000;  // 超过这个时间还没首字，就提示用户"在等模型"

  let sdkPromise = null;
  let client = null;
  let modelsCache = null;

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

  async function modelList(cl) {
    if (modelsCache) return modelsCache;
    try {
      const list = await cl.llm.models.list();
      const arr = Array.isArray(list) ? list : (list && (list.data || list.models)) || [];
      modelsCache = Array.isArray(arr) ? arr : [];
    } catch (e) {
      modelsCache = [];   // 拿不到清单就硬试 PREFERRED，不拦住用户
    }
    return modelsCache;
  }

  /* 从可用清单里挑：只按 PREFERRED 顺序命中，并剔除被标记为不可用的
   * 注意：不要按 canDisableThinking / onlyReasoning 去"猜"快慢。
   * 实测反例：glm-5.3-flash 标着 onlyReasoning + canDisableThinking=false，
   * 但它 reasoning_tokens=0、总耗时最短、输出结构最完整；而按字段推算排前面的
   * deepseek-v4.1-flash 反而给过一份 rewrites/gaps 全空的报告。
   * 顺序只能来自实测，不能来自字段推断。
   */
  async function pickModels(cl) {
    const list = await modelList(cl);
    const ok = id => {
      if (!list.length) return true;                 // 清单拿不到时不拦
      const m = list.find(x => x && x.id === id);
      return !m || (m.enabled !== false && m.disabled !== true);
    };
    const picked = PREFERRED.filter(ok);
    return picked.length ? picked : ["auto"];
  }

  const SYS = "你是简历事实整理与诊断助手。只使用输入里出现的信息，不编造、不升级动词，输出严格 JSON。";

  /* 单个模型跑一次，带超时和流式回调 */
  async function oneCall(cl, model, userContent, onDelta) {
    const t0 = Date.now();
    let text = "";
    let slowTimer = null;
    if (onDelta) {
      slowTimer = setInterval(() => {
        if (!text) onDelta({ kind: "waiting", ms: Date.now() - t0 });
      }, SLOW_HINT_MS);
    }
    const work = (async () => {
      const stream = await cl.llm.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: userContent }
        ],
        stream: true,
        temperature: 0.2
      });
      for await (const chunk of stream) {
        const d = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) {
          if (!text && onDelta) onDelta({ kind: "first", ms: Date.now() - t0 });
          text += d.content;
          if (onDelta) onDelta({ kind: "delta", len: text.length });
        }
      }
      return text;
    })();

    let timer = null;
    try {
      return await Promise.race([
        work,
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("TIMEOUT")), TIMEOUT_MS); })
      ]);
    } finally {
      clearTimeout(timer);
      clearInterval(slowTimer);
    }
  }

  function cleanJSON(t) {
    t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }

  /* 主入口：按模型顺序试，结构不对就换下一个 */
  async function chatJSON(userContent, check, onDelta) {
    const cl = await ensureClient();
    const models = await pickModels(cl);
    const tried = [];
    let lastErr = null;

    for (const model of models.slice(0, 3)) {
      if (onDelta) onDelta({ kind: "model", model: model });
      try {
        const text = await oneCall(cl, model, userContent, onDelta);
        const obj = cleanJSON(text);
        if (!obj) { tried.push(model + "（返回的不是 JSON）"); continue; }
        if (check && !check(obj)) { tried.push(model + "（结构不对，换了下一个）"); continue; }
        return { text: text, obj: obj, model: model, tried: tried };
      } catch (e) {
        const m = String((e && e.message) || e || "");
        lastErr = e;
        tried.push(model + (m === "TIMEOUT" ? "（超时）" : "（调用失败）"));
      }
    }
    const err = new Error("MODEL_ALL_FAILED");
    err.tried = tried;
    err.last = lastErr;
    throw err;
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
    if (m === "MODEL_ALL_FAILED") {
      const t = (e && e.tried && e.tried.length) ? "试过：" + e.tried.join("；") + "。" : "";
      return "几个模型都没跑通。" + t + "可以先填自己的 Key，或者过一会儿再试。";
    }
    if (m === "TIMEOUT") return "单个模型超过 " + (TIMEOUT_MS / 1000) + " 秒没出结果，已自动换模型。";
    return "调用失败：" + m.slice(0, 160) + id;
  }

  window.RD_CLOUD_API = {
    chat: (c, cb) => chatJSON(c, null, cb).then(r => r.text),
    chatJSON: chatJSON,
    explain: explain,
    isOn: () => !!cfg().enabled
  };
})();
