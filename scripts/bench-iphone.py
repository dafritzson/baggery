"""Times tab switches in the web app on a real iPhone, in Safari, over USB.

Mac benchmarks miss what's slow only in iPhone Safari. This drives the app in a Safari tab on a
plugged-in iPhone through Web Inspector: it opens each tab once, then switches through them and
prints, for each switch, the time from the tap until the frame after the new tab is drawn (the
second frame only starts once the first is on screen).

Setup and how to read it: .claude/skills/measure-speed/SKILL.md.
  <venv>/bin/python scripts/bench-iphone.py [rounds]
"""

import asyncio
import sys

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.webinspector import WebinspectorService

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 3

BENCH = """
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const names = ['Draft', 'Standings', 'Games', 'Research', 'Almanac'];
  const tab = (n) => document.querySelector(`[data-tab-bar] [role=tab][aria-label="${n}"]`);
  if (!tab('Draft')) { window.__bench = 'No phone tab bar: sign in, and use a phone-sized window.'; return; }
  for (const n of names) { tab(n).click(); await sleep(1500); }
  const rows = ['tap to drawn (ms)  ' + names.map((n) => n.slice(0, 5).padStart(6)).join('')];
  for (let round = 1; round <= ROUNDS; round++) {
    const times = [];
    for (const n of names) {
      await frame();
      const start = performance.now();
      tab(n).click();
      await frame();
      await frame();
      times.push(performance.now() - start);
      await sleep(500);
    }
    rows.push(`round ${round}            ` + times.map((t) => t.toFixed(0).padStart(6)).join(''));
  }
  rows.push(`DOM nodes: ${document.getElementsByTagName('*').length}`);
  window.__bench = rows.join('\\n');
})();
""".replace('ROUNDS', str(ROUNDS))


async def main():
    # The device connection can log noise as it closes; it doesn't matter.
    asyncio.get_running_loop().set_exception_handler(lambda loop, context: None)
    inspector = WebinspectorService(lockdown=await create_using_usbmux())
    await inspector.connect()
    async with inspector:
        pages = await inspector.get_open_application_pages(timeout=2)
        pages = [p for p in pages if 'baggery' in str(getattr(p.page, 'web_url', ''))]
        if not pages:
            sys.exit('No Baggery tab open in Safari on the iPhone (see the skill for the setup).')
        print('Page:', pages[0].page.web_url)
        session = await inspector.inspector_session(pages[0].application, pages[0].page)
        await session.runtime_enable()
        await session.runtime_evaluate('window.__bench = ""; ' + BENCH)
        # Runtime.evaluate doesn't wait for promises here: the page sets window.__bench when done.
        for _ in range(240):
            await asyncio.sleep(0.5)
            result = await session.runtime_evaluate('window.__bench || ""', return_by_value=True)
            if result:
                print(result)
                return
        sys.exit('Timed out.')


asyncio.run(main())
