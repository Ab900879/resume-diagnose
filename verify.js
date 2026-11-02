// 前端校验器。逻辑和 skill/scripts/verify_citations.py 一致：
// 编号指不回事实库的，删；动词被升级的，拦。

const STRONG_VERBS = ["主导", "牵头", "带领", "统筹", "操盘", "独立完成", "负责", "发起", "推动落地", "全权"];
const WEAK_VERBS = ["参与", "协助", "配合", "执行", "支持", "跟随", "帮忙", "辅助"];

function verifyReport(report, ledger) {
  const byId = {};
  ledger.forEach(f => { byId[f.id] = f; });

  const dropped = [];

  function citesOf(item) {
    return Array.isArray(item.cites) ? item.cites.filter(Boolean) : [];
  }

  function checkItem(item, kindLabel, textOf) {
    const cites = citesOf(item);

    // 1. 引用了不存在的编号
    const unknown = cites.filter(c => !byId[c]);
    if (unknown.length) {
      dropped.push({
        kind: "UNKNOWN_CITATION",
        where: kindLabel,
        text: textOf(item),
        detail: "引用了事实库里不存在的编号 " + unknown.join("、")
      });
      return false;
    }

    // 2. 动词升级：新写的句子里出现强动词，而被引用的事实原文都是弱动词
    const text = textOf(item);
    const strong = STRONG_VERBS.find(v => text.indexOf(v) >= 0);
    if (strong && cites.length) {
      // 原文自己就写了这个动词的，不算升级（例如原文"协助办活动，负责场地对接"）
      const inSource = cites.some(c => {
        const f = byId[c] || {};
        return ((f.text || "") + (f.verb || "")).indexOf(strong) >= 0;
      });
      if (inSource) return true;

      const allWeak = cites.every(c => {
        const v = (byId[c] && byId[c].verb) || "";
        return WEAK_VERBS.some(w => v.indexOf(w) >= 0);
      });
      if (allWeak) {
        dropped.push({
          kind: "VERB_UPGRADE",
          where: kindLabel,
          text: text,
          detail: "出现「" + strong + "」，但 " + cites.join("、") + " 原文是弱动词"
        });
        return false;
      }
    }
    return true;
  }

  const clean = JSON.parse(JSON.stringify(report));

  if (Array.isArray(clean.evidence)) {
    clean.evidence = clean.evidence.filter(it =>
      checkItem(it, "「你手里有什么」", x => x.text || ""));
  }
  if (Array.isArray(clean.gaps)) {
    clean.gaps = clean.gaps.filter(it =>
      checkItem(it, "「你缺什么」", x => (x.title || "") + " " + (x.text || "")));
  }
  if (Array.isArray(clean.rewrites)) {
    clean.rewrites = clean.rewrites.filter(it =>
      checkItem(it, "「哪句怎么改」", x => (x.suggestion || "") + " " + (x.why || "")));
  }
  if (Array.isArray(clean.transferable)) {
    clean.transferable = clean.transferable.filter(it =>
      checkItem(it, "「可迁移项」", x => (x.ability || "") + " " + (x.text || "")));
  }

  return {
    report: clean,
    dropped: dropped,
    ok: dropped.length === 0
  };
}
