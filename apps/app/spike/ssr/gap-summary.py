# SPIKE: python3 -I spike/ssr/gap-summary.py <gap.json> [label]
import json, statistics, sys
rows = json.load(open(sys.argv[1]))
label = sys.argv[2] if len(sys.argv) > 2 else sys.argv[1]
print(f"## {label}")
for page in sorted({r['page'] for r in rows}):
    rs = [r for r in rows if r['page'] == page]
    def col(key, f=lambda v: v):
        vals = [f(r) for r in rs if r.get(key) is not None or key == 'calc']
        return vals
    gaps = [r['gap'] for r in rs if r.get('gap') is not None]
    chrome = [r['chromeHydratedAfterPaint'] for r in rs]
    paint = [r['articlePaint'] for r in rs]
    body = [r['regions'].get('body', 0) - r['articlePaint'] for r in rs]
    long = [max(r['longAfterPaint'] or [0]) for r in rs]
    clicks = [r['clickAfterPaint'] for r in rs]
    replayed = sum(1 for r in rs if any(i['replayedAt'] for i in r['replay']))
    def fmt(v): return f"median {statistics.median(v):.0f}, worst {max(v):.0f}" if v else "n/a"
    print(f"{page}: paint {fmt(paint)} | gap (input at paint -> responded) {fmt(gaps)} | chrome hydrated after paint {fmt(chrome)} | body hydrated after paint {fmt(body)} | longest task after paint {fmt(long)} | click offset {clicks} | replayed {replayed}/{len(rs)} | n={len(rs)}")
    for r in rs:
        print(f"   run{r['run']}: fcp {r.get('fcp')} paint {r['articlePaint']} committed {r.get('committed')} gateTimeout {r.get('gateTimeout')} call {r['hydrateCall']} regions {r['regions']} click {r['clickAt']} responded {r['responded']} gap {r['gap']} replay {r['replay']} long {r.get('longTimeline', r['longAfterPaint'])[:6]} errors {r['errors'][:1]} recov {r.get('recoverable', [])[:2]}")
