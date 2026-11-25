import asyncio, collections, functools, http.server, socketserver, threading
ROOT="/workspace/projects/market-live"; PORT=8773
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer): allow_reuse_address=True
httpd=Q(("127.0.0.1",PORT),Handler); threading.Thread(target=httpd.serve_forever,daemon=True).start()
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":390,"height":844}); pg=await ctx.new_page()
        bad=[]; logs=[]; ws=[]
        pg.on("console", lambda m: logs.append((m.type,m.text[:120])))
        pg.on("response", lambda r: bad.append((r.status,r.url.split('?')[0][:60])) if r.status>=400 else None)
        pg.on("websocket", lambda w: ws.append(w.url))
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        for i in range(5):
            await pg.wait_for_timeout(6000)
            v=await pg.evaluate("() => [document.querySelector('.card[data-id=\"btc\"] .num').textContent, document.querySelector('.card[data-id=\"btc\"] .src .tx').textContent, document.querySelector('#statusText').textContent]")
            print((i+1)*6,"s:",v)
        print("websockets:",ws,"| bad:",collections.Counter(bad),"| console:",logs)
        await b.close()
asyncio.run(main()); httpd.shutdown()
