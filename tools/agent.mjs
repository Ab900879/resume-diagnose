#!/usr/bin/env node
/* 简历诊断 Agent —— 一份简历，适配一类岗位，出四份东西：
 *   1. 诊断报告（HR 视角：这份简历过不过得了这一类岗位的初筛）
 *   2. 改好的简历（纯净版，复制即可投，里面没有任何"依据/说明"字样）
 *   3. 改动说明（每一处改动的原因和出处，单独一份，不混进简历）
 *   4. 事实库（编号条目，下次改简历直接复用）
 *
 * 用法：
 *   node tools/agent.mjs --cv 简历.txt [--jd 岗位JD.txt] [--class 类需求库.md] [--out 输出目录]
 *
 * 不给 --jd 也行：默认按「类岗位需求库」评估——用户拿一份简历投一类岗位，
 * 遇到合适的就投，不会为某一家单独定制。给了 --jd 只用来补特别要求。
 *
 * 走 WorkBuddy 云服务的免密钥模型，不需要自己准备 API Key。
 */

import fs from "fs";
import path from "path";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const cvPath = arg("cv");
const jdPath = arg("jd", "");
const classPath = arg("class", path.join(root, "references", "jd-class-aipm.md"));
const outDir = arg("out", path.join(root, "out"));
if (!cvPath) {
  console.error("用法：node tools/agent.mjs --cv 简历.txt [--jd 岗位JD.txt] [--out 输出目录]");
  process.exit(2);
}
const cv = fs.readFileSync(cvPath, "utf8");
const jd = jdPath ? fs.readFileSync(jdPath, "utf8") : "";
const jdClass = fs.existsSync(classPath) ? fs.readFileSync(classPath, "utf8") : "";
if (!jdClass) {
  console.error("找不到类需求库：" + classPath + "（用 --class 指定，或恢复 references/jd-class-aipm.md）");
  process.exit(2);
}

// ---- 在 Node 里加载浏览器用的 SDK 与前端模块 ----
const g = globalThis;
g.window = g; g.self = g;
g.document = {
  createElement: () => ({ style: {}, getAttribute() {}, setAttribute() {}, appendChild() {}, click() {} }),
  head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, querySelector: () => null
};
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const sdkUrl = "https://unpkg.com/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js";
const sdkSrc = await (await fetch(sdkUrl)).text();
g.WorkBuddyCloud = new Function(sdkSrc + "\n; return WorkBuddyCloud;").call(g);

const cloudCfgSrc = fs.readFileSync(path.join(root, "cloud-config.js"), "utf8");
new Function(cloudCfgSrc).call(g);
new Function(fs.readFileSync(path.join(root, "cloud.js"), "utf8")).call(g);

const P = new Function(
  fs.readFileSync(path.join(root, "prompts.js"), "utf8").replace(/^const /gm, "var ") +
  "; return {buildFactUser, buildDiagUser, buildResumeUser};")();
const V = new Function(
  fs.readFileSync(path.join(root, "verify.js"), "utf8").replace(/^const /gm, "var ") +
  "; return {verifyReport};")();

const t0 = Date.now();
const log = (...a) => console.log(...a);

function checkFact(o) {
  return !!(o && Array.isArray(o.facts) && o.facts.length && o.facts.every(f => f && f.id && f.text));
}
function checkDiag(o) {
  if (!o || !o.class || !o.reason) return false;
  const n = k => (o[k] || []).length;
  if (o.class === "A" || o.class === "B") return n("rewrites") + n("gaps") > 0;
  if (o.class === "C") return n("gaps") + n("transferable") > 0;
  return n("requirements") + n("evidence") + n("gaps") + n("rewrites") > 0;
}
function checkResume(o) {
  return !!(o && typeof o.resume === "string" && o.resume.length > 400);
}

const onDelta = label => e => {
  if (e.kind === "model") log("  · " + label + " 用模型 " + e.model);
  else if (e.kind === "first") log("  · " + label + " 开始输出（" + (e.ms / 1000).toFixed(1) + "s）");
};

log("[1/3] 把简历拆成带编号的事实条目…");
const a = await g.RD_CLOUD_API.chatJSON(P.buildFactUser(cv), checkFact, onDelta("拆简历"));
const facts = a.obj.facts;
log("      拆出 " + facts.length + " 条" + (a.tried.length ? "（换过模型：" + a.tried.join("；") + "）" : ""));

log("[2/3] HR 视角诊断" + (jd ? "（类需求库 + 具体 JD）" : "（类需求库，未给具体 JD）") + "…");
const b = await g.RD_CLOUD_API.chatJSON(P.buildDiagUser(facts, jd, jdClass), checkDiag, onDelta("诊断"));
const report = b.obj;
log("      判定 " + report.class + " 类" + (b.tried.length ? "（换过模型：" + b.tried.join("；") + "）" : ""));

log("[3/3] 生成改好的简历（适配这一类岗位）…");
const c = await g.RD_CLOUD_API.chatJSON(P.buildResumeUser(facts, report, jd, cv, jdClass), checkResume, onDelta("改写"));
const out = c.obj;
// 后处理：丢掉"假改动"（原句和新句去掉标点后完全一样）
function norm(s) { return String(s || "").replace(/[\s，。、；：""''「」（）()｜|·\-—]/g, ""); }
const rawChanges = out.changes || [];
const fake = rawChanges.filter(w => norm(w.original) && norm(w.original) === norm(w.suggestion));
out.changes = rawChanges.filter(w => !fake.includes(w));
if (fake.length) log("      （过滤掉 " + fake.length + " 处没真改的「假改动」）");
log("      改了 " + (out.changes || []).length + " 处，删了 " + (out.removed || []).length + " 项");

// ---- 校验：改好的简历里有没有凭空冒出来的话 ----
const chk = V.verifyReport({ rewrites: out.changes || [] }, facts);
log("\n校验：" + (chk.ok ? "PASS —— 每处改动都能指回你的简历原文"
  : "拦下 " + chk.dropped.length + " 处（找不到出处或动词被升级）"));
chk.dropped.forEach(d => log("  × [" + d.kind + "] " + d.detail + " | " + String(d.text).slice(0, 60)));

// ---- 黑话检查：简历正文里不许出现这些词 ----
const BUZZ = ["闭环", "赋能", "沉淀", "抓手", "颗粒度", "对齐", "打通", "组合拳", "全链路"];
const buzzHit = BUZZ.filter(w => out.resume.includes(w));

// ---- 纯净度检查：02 文件是直接拿去投的，多一个非简历字样都是事故 ----
const DIRTY = ["依据 f-", "依据f-", "（依据", "(依据", "为什么改", "改动说明", "本简历由", "AI 生成", "AI生成"];
const dirtyHit = DIRTY.filter(w => out.resume.includes(w));

if (buzzHit.length || dirtyHit.length) {
  log("⚠ 简历正文不干净：" + [].concat(buzzHit, dirtyHit).join("、") + " —— 需要手动处理");
} else {
  log("      纯净度检查：简历正文可直接投递");
}

// ---- 写文件 ----
fs.mkdirSync(outDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const CLASS_META = {
  A: "A 类 · 措辞型 —— 经历够，问题在怎么说",
  B: "B 类 · 重构型 —— 经历够，但写成了配角",
  C: "C 类 · 资格型 —— 这一类岗位现在不建议投"
};

let md = "# 诊断报告 · " + today + "\n\n";
md += "> 站在招聘方 HR 视角，对照「AI 产品实习」这一类岗位的通用要求（6 份在招 JD 提炼）\n";
if (jd) md += "> 另参考了 1 份具体 JD\n";
md += ">\n> 分类：**" + (CLASS_META[report.class] || report.class) + "**\n>\n> " + (report.reason || "") + "\n\n";
if ((report.requirements || []).length) {
  md += "## 这一类岗位要什么\n\n";
  report.requirements.forEach(r => { md += "- **" + r.id + "** " + r.text + "\n"; });
  md += "\n";
}
if ((report.evidence || []).length) {
  md += "## 你手里有什么（HR 10 秒扫视能不能看到）\n\n| 要求 | 强度 | HR 看到什么 |\n|---|---|---|\n";
  report.evidence.forEach(e => {
    md += "| " + (e.req || "") + " | " + (e.level || "") + " | " + (e.text || "") +
      ((e.cites || []).length ? "（" + e.cites.join(", ") + "）" : "") + " |\n";
  });
  md += "\n";
}
if ((report.gaps || []).length) {
  md += "## 差在哪（面试官会问住你的地方）\n\n";
  report.gaps.forEach(x => {
    md += "- **" + (x.title || "") + "**：" + (x.text || "") +
      ((x.cites || []).length ? "（" + x.cites.join(", ") + "）" : "") + "\n";
  });
  md += "\n";
}
if ((report.rewrites || []).length) {
  md += "## 建议改的句子\n\n";
  report.rewrites.forEach(w => {
    md += "- **" + (w.where || "") + "**\n  - 原：「" + (w.original || "") + "」\n" +
      "  - 改：「" + (w.suggestion || "") + "」\n  - 为什么：" + (w.why || "") + "\n";
  });
  md += "\n";
}
if ((report.transferable || []).length) {
  md += "## 能迁移的能力\n\n";
  report.transferable.forEach(t => {
    md += "- **" + t.ability + "**：" + t.text + ((t.cites || []).length ? "（" + t.cites.join(", ") + "）" : "") + "\n";
  });
  md += "\n";
}
if (report.nextApply) md += "## 那该投什么\n\n" + report.nextApply + "\n\n";
md += "## 关于「投了没回音」——先读这段再下结论\n\n";
md += "这份报告只判断一件事：**简历和这一类岗位匹不匹配**。它不预测、也不承诺投出去有没有回音。\n\n";
md += "投出去 3-4 天没动静，不等于简历有问题。常见原因（按概率排）：\n\n";
md += "1. **招聘方根本没看**。BOSS 直聘上 HR 一天收几百条打招呼，已读不回是常态，不是评价。\n";
md += "2. **岗位其实已满**，挂着只为收简历池。\n";
md += "3. **投递时间不对**。周中上午投的查看率远高于周五晚上。\n\n";
md += "什么时候才该怀疑简历：**同类岗位投了 10 家以上、且多数「已读」之后仍无回复**——那才是简历或匹配度的问题信号，回来重跑一次诊断。\n\n";
md += "---\n\n生成时间 " + today + "　｜　事实库 " + facts.length + " 条　｜　校验 " + (chk.ok ? "PASS" : "拦下 " + chk.dropped.length + " 处") + "\n";

const rp = path.join(outDir, "01-诊断报告-" + today + ".md");
fs.writeFileSync(rp, md, "utf8");

// ---- 02：纯净简历，复制即可投 ----
const rr = path.join(outDir, "02-改好的简历-" + today + ".md");
fs.writeFileSync(rr, out.resume.trim() + "\n", "utf8");

// ---- 03：改动说明，单独一份，不混进简历 ----
let cl = "# 改动说明 · " + today + "\n\n";
cl += "> 这份文档和简历是分开的。简历（02）里没有任何说明文字，直接复制投递；\n";
cl += "> 想知道「为什么这么改」，看这里。\n\n";
cl += "## 改了哪些地方\n\n";
(out.changes || []).forEach((w, i) => {
  cl += (i + 1) + ". **" + (w.where || "") + "**\n   - 原：「" + (w.original || "") + "」\n" +
    "   - 改：「" + (w.suggestion || "") + "」\n   - 为什么：" + (w.why || "") +
    ((w.cites || []).length ? "（依据 " + w.cites.join(", ") + "）" : "") + "\n\n";
});
if ((out.removed || []).length) {
  cl += "## 删了哪些东西（以及为什么）\n\n";
  out.removed.forEach(r => { cl += "- **" + (r.item || "") + "**：" + (r.why || "") + "\n"; });
  cl += "\n";
}
if (out.notes) cl += "## 一句提醒\n\n" + out.notes + "\n";
const clp = path.join(outDir, "03-改动说明-" + today + ".md");
fs.writeFileSync(clp, cl, "utf8");

fs.writeFileSync(path.join(outDir, "04-事实库-" + today + ".json"), JSON.stringify(facts, null, 2), "utf8");

log("\n全程 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
log("  诊断报告 → " + rp);
log("  纯净简历 → " + rr + "（直接投这份）");
log("  改动说明 → " + clp);
log("  事实库   → " + path.join(outDir, "04-事实库-" + today + ".json"));
