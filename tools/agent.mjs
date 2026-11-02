#!/usr/bin/env node
/* 简历诊断 Agent —— 一次输入，出两份东西：
 *   1. 诊断报告（你哪条够、哪条不够、该不该投）
 *   2. 改好的简历全文（可直接投递，每处改动带出处）
 *
 * 用法：
 *   node tools/agent.mjs --cv 简历.txt --jd 岗位JD.txt [--out 输出目录]
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
const jdPath = arg("jd");
const outDir = arg("out", path.join(root, "out"));
if (!cvPath || !jdPath) {
  console.error("用法：node tools/agent.mjs --cv 简历.txt --jd 岗位JD.txt [--out 输出目录]");
  process.exit(2);
}
const cv = fs.readFileSync(cvPath, "utf8");
const jd = fs.readFileSync(jdPath, "utf8");

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

log("[2/3] 对照岗位要求做诊断…");
const b = await g.RD_CLOUD_API.chatJSON(P.buildDiagUser(facts, jd), checkDiag, onDelta("诊断"));
const report = b.obj;
log("      判定 " + report.class + " 类" + (b.tried.length ? "（换过模型：" + b.tried.join("；") + "）" : ""));

log("[3/3] 生成改好的简历…");
const c = await g.RD_CLOUD_API.chatJSON(P.buildResumeUser(facts, report, jd, cv), checkResume, onDelta("改写"));
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

// ---- 写文件 ----
fs.mkdirSync(outDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const CLASS_META = {
  A: "A 类 · 措辞型 —— 经历够，问题在怎么说",
  B: "B 类 · 重构型 —— 经历够，但写成了配角",
  C: "C 类 · 资格型 —— 这个岗现在不建议投"
};

let md = "# 诊断报告 · " + today + "\n\n";
md += "> 分类：**" + (CLASS_META[report.class] || report.class) + "**\n>\n> " + (report.reason || "") + "\n\n";
if ((report.requirements || []).length) {
  md += "## 岗位要什么\n\n";
  report.requirements.forEach(r => { md += "- **" + r.id + "** " + r.text + "\n"; });
  md += "\n";
}
if ((report.evidence || []).length) {
  md += "## 你手里有什么\n\n| 要求 | 强度 | 依据 |\n|---|---|---|\n";
  report.evidence.forEach(e => {
    md += "| " + (e.req || "") + " | " + (e.level || "") + " | " + (e.text || "") +
      ((e.cites || []).length ? "（" + e.cites.join(", ") + "）" : "") + " |\n";
  });
  md += "\n";
}
if ((report.gaps || []).length) {
  md += "## 差在哪\n\n";
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
md += "---\n\n生成时间 " + today + "　｜　事实库 " + facts.length + " 条　｜　校验 " + (chk.ok ? "PASS" : "拦下 " + chk.dropped.length + " 处") + "\n";

const rp = path.join(outDir, "01-诊断报告-" + today + ".md");
fs.writeFileSync(rp, md, "utf8");

let rm = "# 改好的简历 · " + today + "\n\n";
rm += "> 每一处改动都来自你原来的简历，没有新增任何没发生过的事。\n";
rm += "> 联系方式写成占位符，投递前自己填。\n\n---\n\n";
rm += out.resume + "\n\n---\n\n## 改了哪些地方\n\n";
(out.changes || []).forEach((w, i) => {
  rm += (i + 1) + ". **" + (w.where || "") + "**\n   - 原：「" + (w.original || "") + "」\n" +
    "   - 改：「" + (w.suggestion || "") + "」\n   - 为什么：" + (w.why || "") +
    ((w.cites || []).length ? "（依据 " + w.cites.join(", ") + "）" : "") + "\n\n";
});
if ((out.removed || []).length) {
  rm += "## 删了哪些东西（以及为什么）\n\n";
  out.removed.forEach(r => { rm += "- **" + (r.item || "") + "**：" + (r.why || "") + "\n"; });
  rm += "\n";
}
if (out.notes) rm += "## 一句提醒\n\n" + out.notes + "\n";

const rr = path.join(outDir, "02-改好的简历-" + today + ".md");
fs.writeFileSync(rr, rm, "utf8");
fs.writeFileSync(path.join(outDir, "03-事实库-" + today + ".json"), JSON.stringify(facts, null, 2), "utf8");

log("\n全程 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
log("  诊断报告 → " + rp);
log("  改好简历 → " + rr);
