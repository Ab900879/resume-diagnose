(function () {
  const $ = id => document.getElementById(id);
  const LS = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} }
  };

  let ledger = [];
  let report = null;

  // ---------- 设置 ----------
  function cfg() {
    return {
      key: LS.get("rd_key") || "",
      base: LS.get("rd_base") || "https://api.deepseek.com/chat/completions",
      model: LS.get("rd_model") || "deepseek-chat"
    };
  }
  // ---------- 免费试用额度 ----------
  function trialLeft() {
    const t = window.TRIAL || {};
    if (!t || !t.key) return -1;
    const today = new Date().toISOString().slice(0, 10);
    const rec = JSON.parse(LS.get("rd_trial") || "{}");
    if (rec.date !== today) return t.dailyLimit || 3;
    return Math.max(0, (t.dailyLimit || 3) - (rec.n || 0));
  }
  function trialUse() {
    const today = new Date().toISOString().slice(0, 10);
    const rec = JSON.parse(LS.get("rd_trial") || "{}");
    if (rec.date !== today) LS.set("rd_trial", JSON.stringify({ date: today, n: 1 }));
    else LS.set("rd_trial", JSON.stringify({ date: today, n: (rec.n || 0) + 1 }));
  }
  function refreshTrial() {
    const left = trialLeft();
    const sec = $("trialSec");
    if (!$("trialBtn")) return;
    if (left < 0) { sec.style.display = "none"; return; }
    sec.style.display = "block";
    $("trialNote").innerHTML = (window.TRIAL.note || "试用额度由作者承担。") + " 今天还剩 <b>" + left + "</b> 次。";
    $("trialSub").textContent = "试用走的是作者自己的 Key。用完自动回到你自己的 Key，互不影响。";
    $("trialBtn").disabled = left <= 0;
    $("trialBtn").textContent = left > 0 ? "用作者提供的额度（剩 " + left + " 次）" : "今天的额度用完了";
  }
  $("trialBtn").onclick = () => {
    if (trialLeft() <= 0) return;
    LS.set("rd_key", window.TRIAL.key);
    LS.set("rd_base", "https://api.deepseek.com/chat/completions");
    LS.set("rd_model", "deepseek-chat");
    refreshHint(); refreshTrial();
    $("drawer").classList.remove("on");
  };

  // ---------- 运行方式：免 Key 云模式 / 自己的 Key ----------
  function cloudOn() {
    return !!(window.RD_CLOUD && window.RD_CLOUD.enabled && window.RD_CLOUD.endpoint && window.RD_CLOUD_API);
  }
  function cloudLeft() {
    if (!cloudOn()) return -1;
    const today = new Date().toISOString().slice(0, 10);
    const rec = JSON.parse(LS.get("rd_cloud") || "{}");
    if (rec.date !== today) return window.RD_CLOUD.dailyLimit || 5;
    return Math.max(0, (window.RD_CLOUD.dailyLimit || 5) - (rec.n || 0));
  }
  function cloudUse() {
    const today = new Date().toISOString().slice(0, 10);
    const rec = JSON.parse(LS.get("rd_cloud") || "{}");
    LS.set("rd_cloud", JSON.stringify({ date: today, n: (rec.date === today ? (rec.n || 0) : 0) + 1 }));
  }
  // 云服务校验 Origin：只有从应用自己的域名打开时，免 Key 模式才可用
  function cloudHostOk() {
    if (!cloudOn()) return false;
    try {
      const host = new URL(window.RD_CLOUD.endpoint).hostname;
      return location.hostname === host || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    } catch (e) { return false; }
  }
  function useCloud() {
    return LS.get("rd_mode") !== "key" && cloudHostOk() && cloudLeft() !== 0;
  }
  function refreshMode() {
    const sec = $("modeSec");
    if (!$("modeCloud") || !cloudOn()) { if (sec) sec.style.display = "none"; return; }
    sec.style.display = "block";
    if (!cloudHostOk()) {
      $("modeCloud").className = "btn sm ghost";
      $("modeKey").className = "btn sm";
      $("modeNote").innerHTML = "免 Key 模式只在应用自己的域名上生效（云服务会校验来源）。当前是 " +
        location.hostname + "，请用你自己的 Key。";
      return;
    }
    const isCloud = useCloud();
    $("modeCloud").className = "btn sm" + (isCloud ? "" : " ghost");
    $("modeKey").className = "btn sm" + (isCloud ? " ghost" : "");
    const left = Math.max(0, cloudLeft());
    $("modeNote").innerHTML = isCloud
      ? "现在走作者额度，这台设备今天还剩 <b>" + left + "</b> 次。用完自动切回你自己的 Key。"
      : "现在用你自己的 Key。切回作者额度今天还剩 " + left + " 次。";
  }
  if ($("modeCloud")) {
    $("modeCloud").onclick = () => { LS.set("rd_mode", "cloud"); refreshHint(); };
    $("modeKey").onclick = () => { LS.set("rd_mode", "key"); refreshHint(); };
  }

  function refreshHint() {
    const c = cfg();
    const cloud = useCloud();
    const left = Math.max(0, cloudLeft());
    $("factHint").textContent = cloud
      ? ("免 Key 模式，这台设备今天还剩 " + left + " 次")
      : (c.key ? "拆完请自己抽查几条" : "右上角齿轮里选运行方式");
    $("runFact").disabled = !(cloud || c.key);
    $("setState").textContent = cloud
      ? "免 Key 模式（作者额度，剩 " + left + " 次）"
      : (c.key ? "已保存 Key（" + c.key.slice(0, 6) + "…）" : "还没有填 Key");
    const th = $("trialHint");
    const tl = trialLeft();
    if (!cloud && !c.key && tl > 0) {
      th.innerHTML = '<div class="warn-box">没有 Key 也能用：右上角齿轮 → 「用作者提供的额度」，今天还剩 <b>' + tl + '</b> 次。</div>';
    } else {
      th.innerHTML = "";
    }
    refreshMode();
    refreshTrial();
  }
  $("setBtn").onclick = () => {
    const c = cfg();
    $("keyIn").value = c.key;
    $("baseIn").value = c.base;
    $("modelIn").value = c.model;
    $("drawer").classList.add("on");
  };
  $("closeSet").onclick = () => $("drawer").classList.remove("on");
  $("mask").onclick = () => $("drawer").classList.remove("on");
  $("saveSet").onclick = () => {
    LS.set("rd_key", $("keyIn").value.trim());
    LS.set("rd_base", $("baseIn").value.trim() || "https://api.deepseek.com/chat/completions");
    LS.set("rd_model", $("modelIn").value.trim() || "deepseek-chat");
    refreshHint();
    $("drawer").classList.remove("on");
  };

  // ---------- 步骤 ----------
  function step(n) {
    ["p1", "p2", "p3"].forEach((p, i) => $(p).classList.toggle("on", i === n - 1));
    ["st1", "st2", "st3"].forEach((s, i) => {
      const el = $(s);
      el.classList.toggle("on", i === n - 1);
      el.classList.toggle("done", i < n - 1);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- 进度条（动态注入，不动页面结构） ----------
  let runbar = null, runbarT = null, runbarB = null, runTimer = null;
  (function makeBar() {
    const st = document.createElement("style");
    st.textContent =
      "#rdBar{position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff;border-bottom:1px solid #E4E2DC;" +
      "padding:9px 18px;font-size:12.5px;color:#4A4F58;display:flex;align-items:center;gap:10px;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.06);transform:translateY(-100%);transition:transform .18s}" +
      "#rdBar.on{transform:translateY(0)}" +
      "#rdBar .rdDot{width:8px;height:8px;border-radius:50%;background:#1E4468;flex:none;animation:rdPulse 1s infinite}" +
      "@keyframes rdPulse{0%,100%{opacity:1}50%{opacity:.25}}" +
      "#rdBar .rdLine{flex:1;height:3px;background:#EFEDE8;border-radius:2px;overflow:hidden;max-width:220px}" +
      "#rdBar .rdLine i{display:block;height:100%;width:0;background:#1E4468;transition:width .3s}";
    document.head.appendChild(st);
    runbar = document.createElement("div");
    runbar.id = "rdBar";
    runbar.innerHTML = '<span class="rdDot"></span><span id="rdBarT">准备中</span>' +
      '<span class="rdLine"><i id="rdBarB"></i></span><span id="rdBarS" style="color:#8C9099"></span>';
    document.body.appendChild(runbar);
    runbarT = runbar.querySelector("#rdBarT");
    runbarB = runbar.querySelector("#rdBarB");
  })();

  function barShow(text) {
    window.__rdRunning = true;
    runbar.classList.add("on");
    runbarT.textContent = text;
    runbar.querySelector("#rdBarS").textContent = "0s";
    runbarB.style.width = "8%";
    const t0 = Date.now();
    clearInterval(runTimer);
    runTimer = setInterval(() => {
      runbar.querySelector("#rdBarS").textContent = ((Date.now() - t0) / 1000).toFixed(0) + "s";
    }, 1000);
  }
  function barText(text, pct) {
    runbarT.textContent = text;
    if (pct != null) runbarB.style.width = Math.round(pct * 100) + "%";
  }
  function barHide() {
    window.__rdRunning = false;
    clearInterval(runTimer);
    runbar.classList.remove("on");
  }

  // ---------- 调模型（云模式带结构校验 + 自动换模型） ----------
  async function callJSON(userContent, check, label) {
    barShow(label || "正在调用模型…");
    try {
      if (useCloud()) {
        try {
          const r = await window.RD_CLOUD_API.chatJSON(userContent, check, ev => {
            if (ev.kind === "model") barText("用 " + ev.model + " 跑，等它出第一个字…", .12);
            else if (ev.kind === "waiting") barText("模型还在想（" + (ev.ms / 1000).toFixed(0) + "s），正常是 10 秒内", .3);
            else if (ev.kind === "first") barText("模型开始输出了", .45);
            else if (ev.kind === "delta") barText("正在收结果（" + ev.len + " 字）", Math.min(.9, .45 + ev.len / 4000));
          });
          cloudUse();
          refreshHint();
          barText("跑完了", 1);
          return r.obj;
        } catch (e) {
          throw new Error(window.RD_CLOUD_API.explain(e));
        }
      }
      const raw = await callKey(userContent);
      const obj = extractJSON(raw);
      if (check && !check(obj))
        throw new Error("模型这次给的结构不完整（少了关键段落）。再跑一次；如果总是这样，切回免 Key 模式会自动换模型。");
      barText("跑完了", 1);
      return obj;
    } finally {
      setTimeout(barHide, 400);
    }
  }

  async function callLLM(userContent) {
    return JSON.stringify(await callJSON(userContent, null, "正在调用模型…"));
  }

  async function callKey(userContent) {
    const c = cfg();
    if (!c.key) throw new Error("没填 API Key。右上角齿轮里填一个，或者切回免 Key 模式。");

    let res;
    try {
      res = await fetch(c.base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + c.key
        },
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: "user", content: userContent }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 4000
        })
      });
    } catch (e) {
      throw new Error("请求没发出去。可能是网络问题，或者这个接口不允许浏览器直接调用（跨域被拦）。\n换 DeepSeek 的接口试试：https://api.deepseek.com/chat/completions");
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error("Key 不对或没权限（HTTP " + res.status + "）。去右上角检查一下。");
    }
    if (res.status === 402) {
      throw new Error("账户余额不足（HTTP 402）。");
    }
    if (res.status === 429) {
      throw new Error("调用太快被限流了（HTTP 429）。等一分钟再试。");
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error("接口返回 " + res.status + "：\n" + t.slice(0, 300));
    }

    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    if (!content) throw new Error("模型返回了空内容，重试一次。");
    if (window.TRIAL && c.key === window.TRIAL.key) { trialUse(); refreshHint(); }
    return content;
  }

  function extractJSON(text) {
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  }

  function showErr(id, msg) {
    const el = $(id);
    if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
    el.style.display = "block";
    el.textContent = msg;
  }

  // ---------- 第一步：建事实库 ----------
  $("runFact").onclick = async () => {
    const cv = $("cv").value.trim();
    if (cv.length < 60) { showErr("e1", "简历太短了，至少贴一段完整的经历。"); return; }
    showErr("e1", "");
    $("runFact").disabled = true;
    const old = $("runFact").textContent;
    $("runFact").textContent = "正在拆…";
    $("factCard").style.display = "none";

    try {
      const obj = await callJSON(buildFactUser(cv), o =>
        !!(o && Array.isArray(o.facts) && o.facts.length && o.facts.every(f => f && f.id && f.text)),
        "正在把你的简历拆成事实条目…"
      );
      const facts = (obj.facts || []).filter(f => f && f.id && f.text);
      if (!facts.length) throw new Error("模型没给出事实条目。再试一次。");
      ledger = facts;
      LS.set("rd_ledger", JSON.stringify(ledger));
      LS.set("rd_cv", cv);
      LS.set("rd_stage", "1");
      renderFacts();
      $("factCard").style.display = "block";
      if (facts.length <= 5) {
        showErr("e1", "只拆出 " + facts.length + " 条。简历信息偏少，后面的结论会偏保守——这不是模型的问题，是能用的证据确实不够。");
      }
    } catch (e) {
      showErr("e1", e.message);
    } finally {
      $("runFact").disabled = false;
      $("runFact").textContent = old;
    }
  };

  function renderFacts() {
    const box = $("facts");
    box.innerHTML = "";
    $("factCount").textContent = ledger.length + " 条 · 点 × 删除不对的";
    ledger.forEach(f => {
      const d = document.createElement("div");
      d.className = "fact";
      d.innerHTML =
        '<div class="fid">' + esc(f.id) + '</div>' +
        '<div class="ft"><b>' + esc(f.type || "") + '</b>　' + esc(f.text) +
        (f.verb && f.verb !== "未标注" ? '　<span style="color:#8C9099;font-size:11.5px">动词原文：' + esc(f.verb) + '</span>' : "") +
        '</div>' +
        '<div class="fv">' + esc(f.verifiable || "") + '</div>' +
        '<button class="del" title="删除">×</button>';
      d.querySelector(".del").onclick = () => {
        ledger = ledger.filter(x => x.id !== f.id);
        LS.set("rd_ledger", JSON.stringify(ledger));
        renderFacts();
      };
      box.appendChild(d);
    });
  }

  // ---------- 第二步：诊断 ----------
  $("toJd").onclick = () => step(2);
  $("back1").onclick = () => step(1);
  $("back2").onclick = () => step(2);

  $("runDiag").onclick = async () => {
    const jd = $("jd").value.trim();
    if (jd.length < 20) { showErr("e2", "JD 太短了。至少贴一段岗位要求。"); return; }
    if (!ledger.length) { showErr("e2", "事实库是空的，回去先把简历拆了。"); return; }
    showErr("e2", "");
    const btn = $("runDiag");
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "正在诊断…";

    try {
      report = await callJSON(buildDiagUser(ledger, jd), o => {
        if (!o || !o.class || !o.reason) return false;
        const n = k => (o[k] || []).length;
        // 分类不同，该有的东西也不同：光给个分类、下面全是空的，不算跑通
        if (o.class === "A" || o.class === "B") return n("rewrites") + n("gaps") > 0;
        if (o.class === "C") return n("gaps") + n("transferable") > 0;
        return n("requirements") + n("evidence") + n("gaps") + n("rewrites") > 0;
      }, "正在对照岗位要求做诊断…");
      LS.set("rd_jd", jd);
      LS.set("rd_report", JSON.stringify(report));
      LS.set("rd_stage", "2");
      step(3);
      renderReport();
    } catch (e) {
      showErr("e2", e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };

  // ---------- 渲染报告 ----------
  const CLASS_META = {
    A: { name: "A 类 · 措辞型", verdict: "可以投。问题在怎么说" },
    B: { name: "B 类 · 重构型", verdict: "经历够，但写成了配角" },
    C: { name: "C 类 · 资格型", verdict: "现在不建议投这个岗" }
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function citeBtns(cites) {
    if (!Array.isArray(cites) || !cites.length) return "";
    return cites.map(c => '<button class="fid-btn" data-id="' + esc(c) + '">' + esc(c) + '</button>').join("");
  }

  function renderReport() {
    const v = verifyReport(report, ledger);
    const r = v.report;
    const cls = (r.class || "A").toUpperCase().charAt(0);
    const meta = CLASS_META[cls] || CLASS_META.A;
    let html = "";

    html += '<div class="verdict ' + cls + '">' +
      '<span class="vtag">' + esc(meta.name) + '</span>' +
      '<div><div class="vt">' + esc(meta.verdict) + '</div>' +
      '<div class="vd">' + esc(r.reason || "") + '</div></div></div>';

    // 岗位要什么
    if (Array.isArray(r.requirements) && r.requirements.length) {
      html += block("这个岗位要什么", r.requirements.map(q =>
        '<div class="line"><span class="k">' + esc(q.id || "") + '</span><span class="v">' + esc(q.text) + '</span></div>'
      ).join(""));
    }

    // 你手里有什么
    if (Array.isArray(r.evidence) && r.evidence.length) {
      html += block("你手里有什么", r.evidence.map(e => {
        const lv = { "强": "s", "中": "m", "弱": "w", "无": "n" }[e.level] || "n";
        return '<div class="line"><span class="k">' + esc(e.req || "") + '</span>' +
          '<span class="v"><span class="lv ' + lv + '">' + esc(e.level || "") + '</span>' +
          esc(e.text) + citeBtns(e.cites) + '</span></div>';
      }).join(""));
    }

    // 缺什么
    if (Array.isArray(r.gaps) && r.gaps.length) {
      html += block("缺什么", r.gaps.map(g =>
        '<div class="line"><span class="k">' + esc(g.title || "") + '</span>' +
        '<span class="v">' + esc(g.text) + citeBtns(g.cites) + '</span></div>'
      ).join(""));
    }

    // 可迁移项（C 类）
    if (Array.isArray(r.transferable) && r.transferable.length) {
      html += block("你真正能带走的东西", r.transferable.map(t =>
        '<div class="line"><span class="k">' + esc(t.ability || "") + '</span>' +
        '<span class="v">' + esc(t.text) + citeBtns(t.cites) + '</span></div>'
      ).join(""));
    }

    // 时间账（C 类）
    if (r.timeline && r.timeline.months) {
      const t = r.timeline;
      html += block("时间账", 
        '<div class="line"><span class="k">补齐最短</span><span class="v"><b>' + esc(t.months) + ' 个月</b></span></div>' +
        '<div class="line"><span class="k">卡点</span><span class="v">' + esc(t.blocker || "") + '</span></div>' +
        '<div class="line"><span class="k">本周能做</span><span class="v">' + esc(t.firstStep || "") + '</span></div>' +
        (r.nextApply ? '<div class="line"><span class="k">先投什么</span><span class="v">' + esc(r.nextApply) + '</span></div>' : "")
      );
    }

    // 追问（B 类）
    if (Array.isArray(r.questions) && r.questions.length) {
      html += block("先回答这三个问题，我再动你的措辞", r.questions.map((q, i) =>
        '<div class="line"><span class="k">问 ' + (i + 1) + '</span><span class="v">' + esc(q) + '</span></div>'
      ).join("") +
        '<div class="line"><span class="k"></span><span class="v" style="color:#8C9099;font-size:12.5px">' +
        '在你的原话里这些事都还是「配合」的，我不给你升级成「主导」——面试第一问就会露。</span></div>');
    }

    // 逐句改写
    if (Array.isArray(r.rewrites) && r.rewrites.length) {
      html += block("哪几句该怎么改", r.rewrites.map(w =>
        '<div class="rw">' +
        '<div class="rw-where">' + esc(w.where || "") + '</div>' +
        '<div class="rw-old">原：' + esc(w.original || "") + '</div>' +
        '<div class="rw-new">' + esc(w.suggestion || "") + '</div>' +
        '<div class="rw-why">' + esc(w.why || "") + citeBtns(w.cites) + '</div>' +
        '</div>'
      ).join(""));
    }

    html += '<div class="src" id="srcBox"><div class="sh" id="srcH"></div><div id="srcT"></div></div>';
    $("report").innerHTML = html;

    $("report").querySelectorAll(".fid-btn").forEach(b => {
      b.onclick = () => {
        const f = ledger.find(x => x.id === b.dataset.id);
        if (!f) return;
        const box = $("srcBox");
        $("srcH").textContent = "事实溯源 " + f.id;
        $("srcT").innerHTML = '<b style="color:#16181D">' + esc(f.text) + '</b><br>' +
          '<span style="color:#8C9099;font-size:11.5px">来源：' + esc(f.source || "未标注") +
          '　动词原文：' + esc(f.verb || "未标注") + '　可验证性：' + esc(f.verifiable || "") + '</span>';
        box.classList.add("on");
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    });

    renderCheck(v);
  }

  function block(title, inner) {
    return '<div class="blk"><div class="blk-h">' + esc(title) + '</div><div class="blk-b">' + inner + '</div></div>';
  }

  function renderCheck(v) {
    const box = $("check");
    if (v.ok) {
      box.innerHTML = '<div class="chk ok"><span class="cn">PASS</span>' +
        '<span class="cd">每条结论都能指回你的简历原文，没有发现编造或动词升级。</span></div>';
      return;
    }
    let h = '<div class="chk bad"><span class="cn">拦下 ' + v.dropped.length + ' 条</span>' +
      '<span class="cd">下面这些句子在校验时被删掉了，因为它们在你的简历里找不到出处，或者把原文的「协助」写成了「主导」。</span></div>';
    h += '<div class="blk"><div class="blk-h">被删掉的内容</div><div class="blk-b">';
    v.dropped.forEach(d => {
      h += '<div class="line"><span class="k" style="min-width:110px">' + (d.kind === "VERB_UPGRADE" ? "动词升级" : "找不到出处") + '</span>' +
        '<span class="v">' + esc(d.text) + '<br><span style="color:#B4552D;font-size:12px">' + esc(d.detail) + '</span></span></div>';
    });
    h += '</div></div>';
    box.innerHTML = h;
  }

  // ---------- 示例报告（不需要 Key） ----------
  const demoBtn = $("demoBtn");
  if (demoBtn) {
    demoBtn.onclick = () => {
      if (typeof DEMO === "undefined") return;
      ledger = DEMO.ledger.slice();
      report = JSON.parse(JSON.stringify(DEMO.report));
      renderFacts();
      $("factCard").style.display = "block";
      step(3);
      renderReport();
      const tip = document.createElement("div");
      tip.style.cssText = "margin-top:18px;padding:12px 15px;background:#FBFAF8;border:1px dashed #E4E2DC;border-radius:7px;font-size:12.5px;color:#8C9099;line-height:1.7";
      tip.textContent = "这是内置示例：一份虚构简历 + AI 产品实习 JD 的真实输出，没有调用你的 Key。想跑自己的简历，点左上角回到第一步。";
      $("report").appendChild(tip);
    };
  }

  // ---------- 文件上传 ----------
  function bindUpload(dropId, fileId, taId, statId, stT, stB) {
    const drop = $(dropId), inp = $(fileId), ta = $(taId);
    const stat = $(statId), st = $(stT), sb = $(stB);
    if (!drop || !window.RD_FILES) return;

    function setStat(msg, p, warn) {
      stat.classList.add("on");
      stat.classList.toggle("warn", !!warn);
      st.textContent = msg;
      sb.style.width = Math.round((p || 0) * 100) + "%";
    }

    async function handle(file) {
      if (!file) return;
      drop.classList.add("busy");
      setStat("读取 " + file.name + " …", .08);
      try {
        const r = await window.RD_FILES.readAny(file, (m, p) => setStat(m, p));
        ta.value = r.text;
        setStat(r.warn ? r.warn : (r.kind + " 读完了，共 " + r.text.length + " 字，可直接拆"), 1, !!r.warn);
      } catch (e) {
        setStat(e.message, 1, true);
      } finally {
        drop.classList.remove("busy");
        inp.value = "";
      }
    }

    drop.onclick = () => inp.click();
    inp.onchange = () => handle(inp.files && inp.files[0]);
    ["dragenter", "dragover"].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "dragend"].forEach(ev =>
      drop.addEventListener(ev, e => { drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => {
      e.preventDefault();
      drop.classList.remove("over");
      const dt = e.dataTransfer;
      handle(dt && dt.files && dt.files[0]);
    });
  }
  bindUpload("dropCv", "fileCv", "cv", "statCv", "statCvT", "statCvB");
  bindUpload("dropJd", "fileJd", "jd", "statJd", "statJdT", "statJdB");

  // ---------- 导出报告 ----------
  function toMarkdown() {
    const v = verifyReport(report, ledger);
    const r = v.report;
    const cites = c => (Array.isArray(c) && c.length) ? "（" + c.join(", ") + "）" : "";
    let md = "# 简历诊断报告\n\n";
    md += "- 分类：" + (r.class || "") + "\n- 判断：" + (r.reason || "") + "\n\n";

    function sect(title, arr, f) {
      if (!Array.isArray(arr) || !arr.length) return;
      md += "## " + title + "\n\n";
      arr.forEach(x => { md += "- " + f(x) + "\n"; });
      md += "\n";
    }
    sect("这个岗位要什么", r.requirements, x => (x.id ? "[" + x.id + "] " : "") + x.text);
    sect("你手里有什么", r.evidence, x =>
      "[" + (x.level || "") + "] " + (x.req ? x.req + "：" : "") + x.text + cites(x.cites));
    sect("缺什么", r.gaps, x => (x.title ? "**" + x.title + "**：" : "") + x.text + cites(x.cites));
    sect("你真正能带走的东西", r.transferable, x =>
      (x.ability ? "**" + x.ability + "**：" : "") + x.text + cites(x.cites));

    if (r.timeline && r.timeline.months) {
      md += "## 时间账\n\n- 补齐最短：" + r.timeline.months + " 个月\n";
      md += "- 卡点：" + (r.timeline.blocker || "") + "\n";
      md += "- 本周能做：" + (r.timeline.firstStep || "") + "\n";
      if (r.nextApply) md += "- 先投什么：" + r.nextApply + "\n";
      md += "\n";
    }
    sect("先回答这几个问题", r.questions, x => x);

    if (Array.isArray(r.rewrites) && r.rewrites.length) {
      md += "## 哪几句该怎么改\n\n";
      r.rewrites.forEach(w => {
        md += "**" + (w.where || "") + "**\n\n";
        md += "- 原：" + (w.original || "") + "\n";
        md += "- 改为：" + (w.suggestion || "") + "\n";
        md += "- 为什么：" + (w.why || "") + cites(w.cites) + "\n\n";
      });
    }

    md += "## 事实库\n\n";
    ledger.forEach(f => {
      md += "- " + f.id + " [" + (f.type || "") + "] " + f.text +
        "（动词原文：" + (f.verb || "") + "，可验证性：" + (f.verifiable || "") + "）\n";
    });
    md += "\n---\n\n校验结果：" + (v.ok ? "PASS —— 每条结论都能指回原文" : "拦下 " + v.dropped.length + " 条（找不到出处或动词被升级）") + "\n";
    return md;
  }
  $("exportBtn").onclick = () => {
    if (!report) return;
    const blob = new Blob([toMarkdown()], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "简历诊断-" + new Date().toISOString().slice(0, 10) + ".md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- 初始 ----------
  $("newCv").onclick = () => {
    ledger = []; report = null;
    LS.del("rd_ledger"); LS.del("rd_cv"); LS.del("rd_jd"); LS.del("rd_report"); LS.del("rd_stage");
    $("cv").value = ""; $("jd").value = "";
    $("factCard").style.display = "none";
    $("facts").innerHTML = "";
    step(1);
  };

  // 关掉页面 / 跳走之前的结果都还在：简历、JD、事实库、报告全部落在本地
  const savedLedger = LS.get("rd_ledger");
  if (savedLedger) {
    try {
      ledger = JSON.parse(savedLedger);
      if (Array.isArray(ledger) && ledger.length) {
        renderFacts();
        $("factCard").style.display = "block";
      }
    } catch (e) { ledger = []; }
  }
  const savedCv = LS.get("rd_cv");
  if (savedCv) $("cv").value = savedCv;
  const savedJd = LS.get("rd_jd");
  if (savedJd) $("jd").value = savedJd;

  const savedReport = LS.get("rd_report");
  if (savedReport && ledger.length) {
    try {
      report = JSON.parse(savedReport);
      if (report && report.class) {
        step(3);
        renderReport();
        const tip = document.createElement("div");
        tip.style.cssText = "margin-top:18px;padding:12px 15px;background:#FBFAF8;border:1px dashed #E4E2DC;border-radius:7px;font-size:12.5px;color:#8C9099;line-height:1.7";
        tip.textContent = "这是你上次跑出来的结果，一直存在这台设备的浏览器里——关掉页面、跳走再回来都还在。想重跑就点左上角「换一份简历」。";
        $("report").appendChild(tip);
      }
    } catch (e) { report = null; }
  } else if (ledger.length) {
    // 只拆了事实库、还没诊断：直接回到第二步，不用重拆
    step(2);
    showErr("e2", "");
  }

  // 跑到一半离开页面时提醒一句（不是拦，是让知道自己会丢什么）
  window.addEventListener("beforeunload", e => {
    if (!window.__rdRunning) return;
    e.preventDefault();
    e.returnValue = "还在跑，现在离开这次就白跑了。";
    return e.returnValue;
  });

  refreshHint();
})();
