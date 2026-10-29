#!/bin/bash
# Runs each b20y group at each size, one at a time, retrying a failed one (up to 3 tries). Usage: b20runner.sh "b20q b20p" "desktop phone"
S=/c/Users/march/AppData/Local/Temp/claude/C--Users-march-OneDrive-Documents-underwater-game/0dbdc5c7-d413-400f-bc23-94c77a2090d0/scratchpad/media24
cd /c/Users/march/Projects/playtest-lite
node $S/assemble.cjs b20y > /dev/null
for g in $1; do
  for z in $2; do
    for try in 1 2; do
      while [ -e $S/OUTAGE-IN-PROGRESS ]; do sleep 20; done
      until curl -s -m 20 -o /dev/null http://localhost:3450/api/health; do sleep 10; done
      log=$S/logs/run-$g-$z-$try.log
      BROWSER_CHANNEL=chrome BASE=http://localhost:3450 MEDIA_DB=playtest_lite_media ONLY=$g SIZES=$z timeout 1800 node scripts/media-run-b20y.cjs > $log 2>&1
      if grep -q "$g $z: pass" $log; then echo "PASS $g $z (try $try)"; break; fi
      echo "FAIL $g $z (try $try): $(grep -m1 FAILED $log | cut -c1-200)"
    done
  done
done
echo "RUNNER DONE"
