import asyncio, json, os, functools, http.server, socketserver, threading

ROOT = "/workspace/projects/market-live"
OUT = "/workspace/projects/market-live/screenshots"
PORT = 8768
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer):
    allow_reuse_address = True
httpd = Q(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page = await ctx.new_page()
        errors, logs = [], []
        page.on("console", lambda m: logs.append((m.type, m.text[:120])))
        page.on("pageerror", lambda e: errors.append(str(e)))
        # 모든 외부 API 차단 → 실패 상태 UI 확인
        await page.route("**/*", lambda route: route.abort()
                         if route.request.url.startswith("http://127.0.0.1") is False else route.continue_())
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(6000)
        state = await page.evaluate("""() => ({
            status: document.querySelector('#statusText').textContent.trim(),
            dot: document.querySelector('#statusDot').className,
            cards: [...document.querySelectorAll('.card')].map(c => ({
                id: c.dataset.id,
                num: c.querySelector('.num').textContent.trim(),
                src: c.querySelector('.src .tx').textContent.trim()
            }))
        })""")
        # 복사 버튼: 데이터 없을 때도 문구가 만들어지는지
        share = await page.evaluate("() => window.buildShareText()")
        await page.screenshot(path=f"{OUT}/offline.png", full_page=False)
        print(json.dumps({"state": state, "share": share, "errors": errors,
                          "console": [l for l in logs if l[0] in ('error', 'warning')]},
                         ensure_ascii=False, indent=1))
        await b.close()

asyncio.run(run())
httpd.shutdown()
