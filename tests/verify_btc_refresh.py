import asyncio, json, functools, http.server, socketserver, threading
ROOT="/workspace/projects/market-live"; PORT=8770
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer): allow_reuse_address=True
httpd=Q(("127.0.0.1",PORT),Handler); threading.Thread(target=httpd.serve_forever,daemon=True).start()
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":390,"height":800}); pg=await ctx.new_page()
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await pg.wait_for_function("document.querySelector('.chip.prem b').textContent.trim() !== '–'", timeout=25000)
        a=await pg.evaluate("() => [document.querySelector('.chip.prem b').textContent, document.querySelector('.chip.usd b').textContent, document.querySelector('.src .tx').textContent]")
        await pg.wait_for_timeout(32000)
        c=await pg.evaluate("() => [document.querySelector('.chip.prem b').textContent, document.querySelector('.chip.usd b').textContent, document.querySelector('.src .tx').textContent]")
        print("A:", a); print("B:", c)
        await b.close()
asyncio.run(main()); httpd.shutdown()
