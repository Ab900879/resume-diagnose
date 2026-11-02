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
  function refreshHint() {
    const c = cfg();
    $("factHint").textContent = c.key ? "拆完请自己抽查几条" : "需要先在右上角填 API Key";
    $("runFact").disabled = !c.key;
    $("setState").textContent = c.key ? "已保存 Key（" + c.key.slice(0, 6) + "…）" : "还没有填 Key";
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

  // ---------- 调模型 ----------
  async function callLLM(userContent) {
    const c = cfg();
    if (!c.key) throw new Error("没填 API Key。点右上角齿轮填一个。");

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
      const raw = await callLLM(buildFactUser(cv));
      const obj = extractJSON(raw);
      const facts = (obj.facts || []).filter(f => f && f.id && f.text);
      if (!facts.length) throw new Error("模型没给出事实条目。再试一次。");
      ledger = facts;
      LS.set("rd_ledger", JSON.stringify(ledger));
      LS.set("rd_cv", cv);
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
      const raw = await callLLM(buildDiagUser(ledger, jd));
      report = extractJSON(raw);
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
      html += block("哪几句该怎么改", r.rewrites.map((w, i) =>
        '<div style="padding:10px 0;border-top:' + (i ? '1px solid #EFEDE8' : 'none') + '">' +
        '<div style="font-size:12px;color:#8C9099;margin-bottom:6px">' + esc(w.where || "") + '</div>' +
        '<div style="font-size:12.5px;color:#8C9099;text-decoration:line-through;margin-bottom:6px">原：' + esc(w.original || "") + '</div>' +
        '<div style="font-size:13.5px;color:#16181D;background:#FBFAF8;padding:9px 11px;border-radius:6px;border-left:2px solid #1E4468">' + esc(w.suggestion || "") + '</div>' +
        '<div style="font-size:12.5px;color:#4A4F58;margin-top:7px">' + esc(w.why || "") + citeBtns(w.cites) + '</div>' +
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

  // ---------- 初始 ----------
  $("newCv").onclick = () => {
    ledger = []; report = null;
    LS.del("rd_ledger"); LS.del("rd_cv");
    $("cv").value = ""; $("jd").value = "";
    $("factCard").style.display = "none";
    $("facts").innerHTML = "";
    step(1);
  };

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

  refreshHint();
})();
