import asyncio, json, os, functools, http.server, socketserver, threading
ROOT = "/workspace/projects/market-live"; OUT = f"{ROOT}/screenshots"
PORT = 8769
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer): allow_reuse_address = True
httpd = Q(("127.0.0.1", PORT), Handler); threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, w in [("small", 320), ("mid", 360), ("mobile", 390)]:
            ctx = await b.new_context(viewport={"width": w, "height": 800}, device_scale_factor=2)
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await pg.wait_for_function("document.querySelector('.card[data-id=\"gold\"] .num').textContent.trim() !== '–'", timeout=25000)
            await pg.wait_for_timeout(1200)
            info = await pg.evaluate("""() => ({
              cols: getComputedStyle(document.querySelector('.grid')).gridTemplateColumns,
              overflow: document.documentElement.scrollWidth > window.innerWidth,
              clipped: [...document.querySelectorAll('.num')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent)
            })""")
            await pg.screenshot(path=f"{OUT}/{name}.png", full_page=True)
            print(name, json.dumps(info, ensure_ascii=False), "errors:", errs)
            await ctx.close()
        await b.close()

asyncio.run(main()); httpd.shutdown()
