# SPIKE: python3 -I spike/ssr/summarize.py spike/ssr/out/hydrate-check.json
import json, sys
rows = json.load(open(sys.argv[1]))
for r in rows:
    print(r['url'][-30:], '|', r['condition'], '| fcp', r['fcp'], 'lcp', r.get('lcp'), 'resp', r['responseEnd'], 'hyd', r['hydrationStart'], '->', r['hydrated'],
          'pre', r['preloadMs'], 'cls', r['cls'], 'live', r.get('interactive'), 'longtask', r.get('longestTask'), 'art', r['articleInDom'], 'dark', r['dark'], '| mismatches', len(r['recoverable']))
    for m in r['recoverable'][:2]:
        print('     M:', m[:400])
    for m in r['consoleErrors'][:2]:
        print('     E:', m[:200])
