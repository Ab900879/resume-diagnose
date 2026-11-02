#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验诊断报告里的引用是否都能指回事实库，以及动词有没有被升级。

用法：
    python verify_citations.py --report 报告.md --ledger ledger.json

退出码：0 = PASS，1 = 有问题。
"""

import argparse
import json
import os
import re
import sys

CITATION = re.compile(r"f-\d{3}")

# 强动词：事实库里记为弱动词的，输出里出现这些就算升级
STRONG_VERBS = [
    "主导", "牵头", "带领", "统筹", "操盘", "独立完成",
    "负责", "负责了", "发起", "推动落地",
]

# 弱动词：原文用了这些，输出就不许升级
WEAK_VERBS = [
    "参与", "协助", "配合", "执行", "支持", "跟随", "帮忙", "辅助",
]


def load_ledger(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    facts = data["facts"] if isinstance(data, dict) else data
    return {f["id"]: f for f in facts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--ledger", required=True)
    args = ap.parse_args()

    for p in (args.report, args.ledger):
        if not os.path.exists(p):
            print("文件不存在: %s" % p)
            sys.exit(1)

    facts = load_ledger(args.ledger)
    with open(args.report, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    used = set()
    unknown = []
    upgrades = []

    for no, line in enumerate(lines, 1):
        ids = CITATION.findall(line)
        for cid in ids:
            used.add(cid)
            if cid not in facts:
                unknown.append((no, cid, line.strip()[:70]))

        if not ids:
            continue

        # 这一行里出现了强动词，但引用的每条事实原文都是弱动词 -> 升级
        hit = [v for v in STRONG_VERBS if v in line]
        if not hit:
            continue

        cited = [facts[c] for c in ids if c in facts]
        if not cited:
            continue
        if all(
            any(w in (f.get("verb") or "") for w in WEAK_VERBS) for f in cited
        ):
            upgrades.append((no, hit[0], ids, line.strip()[:70]))

    print("=" * 60)
    print("报告: %s" % os.path.basename(args.report))
    print("事实库: %d 条" % len(facts))
    print("报告引用: %d 个编号" % len(used))
    print("-" * 60)

    ok = True

    if unknown:
        ok = False
        print("[UNKNOWN_CITATION] %d 处引用了事实库里不存在的编号：" % len(unknown))
        for no, cid, snippet in unknown:
            print("  第 %d 行 [%s]  %s" % (no, cid, snippet))
        print("  处理：删掉那一句，或把这条事实补进事实库后重新编号。")
        print()

    if upgrades:
        ok = False
        print("[VERB_UPGRADE] %d 处动词被升级：" % len(upgrades))
        for no, verb, ids, snippet in upgrades:
            print("  第 %d 行 出现「%s」，引用 %s 原文是弱动词" % (no, verb, ",".join(ids)))
            print("      %s" % snippet)
        print("  处理：改回原动词。这是产品第一条铁律。")
        print()

    unused = sorted(set(facts) - used)
    if unused:
        print("[提示] 事实库里有 %d 条没被用到：%s" % (len(unused), ", ".join(unused[:12])))
        print()

    if ok:
        print("PASS  所有引用都能指回事实库，没有动词升级。")
        sys.exit(0)

    print("FAIL  修完再交付。")
    sys.exit(1)


if __name__ == "__main__":
    main()
