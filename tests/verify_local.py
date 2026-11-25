import asyncio, json, os, functools, http.server, socketserver, threading

ROOT = "/workspace/projects/market-live"
OUT = "/workspace/projects/market-live/screenshots"
os.makedirs(OUT, exist_ok=True)
PORT = 8767

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer):
    allow_reuse_address = True
httpd = Q(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.async_api import async_playwright

UA_MOBILE = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"

SNAP = """() => {
  const out = {};
  document.querySelectorAll('.card').forEach(c => {
    const q = s => (c.querySelector(s)?.textContent || '').trim().replace(/\\s+/g,' ');
    out[c.dataset.id] = { num: q('.num'), delta: q('.delta'), src: q('.src .tx'), tag: q('.tag'),
      g: q('.conv .g'), don: q('.conv .don'), prem: q('.chip.prem b'), usd: q('.chip.usd b'),
      cls: c.className };
  });
  return { cards: out, status: document.querySelector('#statusText').textContent.trim(),
    count: document.querySelector('#countdown').textContent.trim(),
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
}"""

async def run():
    report = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for name, vp in [("mobile", {"width": 390, "height": 844}),
                         ("small", {"width": 320, "height": 780}),
                         ("desktop", {"width": 1280, "height": 900})]:
            ctx = await browser.new_context(viewport=vp, device_scale_factor=2,
                                            user_agent=UA_MOBILE if name != "desktop" else None)
            page = await ctx.new_page()
            logs, errors, failed = [], [], []
            page.on("console", lambda m: logs.append((m.type, m.text)))
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("requestfailed", lambda r: failed.append([r.url[:110], str(r.failure)]))
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            try:
                await page.wait_for_function(
                    "document.querySelector('.card[data-id=\"kospi\"] .num')?.textContent.trim() !== '–' && "
                    "document.querySelector('.card[data-id=\"gold\"] .num')?.textContent.trim() !== '–' && "
                    "document.querySelector('.card[data-id=\"btc\"] .num')?.textContent.trim() !== '–'",
                    timeout=30000)
            except Exception as e:
                print("WAIT FAIL", name, type(e).__name__)
            await page.wait_for_timeout(2500)
            snap = await page.evaluate(SNAP)

            # 공유 문구
            share = await page.evaluate("() => window.buildShareText ? window.buildShareText() : 'NO_FN'")

            # 복사 버튼 동작
            await page.click("#copyBtn")
            await page.wait_for_timeout(400)
            toast = await page.evaluate("() => document.querySelector('#toast').textContent")

            await page.screenshot(path=f"{OUT}/{name}.png", full_page=True)

            # 30초 자동 갱신 확인 (모바일만)
            auto = None
            if name == "mobile":
                before = snap["status"]
                await page.wait_for_timeout(31000)
                after = await page.evaluate("() => document.querySelector('#statusText').textContent.trim()")
                auto = {"before": before, "after": after, "changed": before != after}

            report[name] = {"snap": snap, "share": share, "toast": toast, "autoRefresh": auto,
                            "console": logs, "pageerrors": errors, "failed": failed}
            await ctx.close()
        await browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=1))

asyncio.run(run())
httpd.shutdown()
