import asyncio, json, functools, http.server, socketserver, threading, collections
ROOT="/workspace/projects/market-live"; PORT=8772
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer): allow_reuse_address=True
httpd=Q(("127.0.0.1",PORT),Handler); threading.Thread(target=httpd.serve_forever,daemon=True).start()
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":390,"height":844}); pg=await ctx.new_page()
        logs, errs, failed = [], [], []
        codes = collections.Counter()
        pg.on("console", lambda m: logs.append((m.type, m.text[:120])))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("requestfailed", lambda r: failed.append([r.url[:90], str(r.failure)]))
        pg.on("response", lambda r: codes.update([f"{r.status} {r.url.split('?')[0][:45]}"]))
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        for i in range(6):
            await pg.wait_for_timeout(10000)
            st = await pg.evaluate("() => ({s:document.querySelector('#statusText').textContent.trim(), v:document.querySelector('.card[data-id=\"wti\"] .num').textContent, b:document.querySelector('.card[data-id=\"btc\"] .num').textContent})")
            print(i*10+10, "s:", st)
        print("codes:", {k:v for k,v in codes.items() if not k.startswith('200')})
        print("console:", logs); print("errors:", errs); print("failed:", failed)
        await b.close()
asyncio.run(main()); httpd.shutdown()
