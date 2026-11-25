import asyncio, json, os, functools, http.server, socketserver, threading, collections
ROOT = "/workspace/projects/market-live"; OUT = f"{ROOT}/screenshots"
PORT = 8771
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer): allow_reuse_address = True
httpd = Q(("127.0.0.1", PORT), Handler); threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.async_api import async_playwright

UA = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"
SNAP = """() => ({cards:[...document.querySelectorAll('.card')].map(c=>({id:c.dataset.id,num:c.querySelector('.num').textContent.trim(),delta:c.querySelector('.delta').textContent.replace(/\\s+/g,' ').trim(),src:c.querySelector('.src .tx').textContent.trim(),tag:c.querySelector('.tag')?.textContent||'',g:c.querySelector('.conv .g')?.textContent||''})), status:document.querySelector('#statusText').textContent.trim(), count:document.querySelector('#countdown').textContent.trim(), overflow:document.documentElement.scrollWidth-window.innerWidth})"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp, dev in [("v2-mobile", {"width": 390, "height": 844}, 2), ("v2-desktop", {"width": 1280, "height": 900}, 1)]:
            ctx = await b.new_context(viewport=vp, device_scale_factor=dev, user_agent=UA if name.endswith("mobile") else None)
            pg = await ctx.new_page()
            logs, errs, failed = [], [], []
            reqs = collections.Counter()
            pg.on("console", lambda m: logs.append((m.type, m.text[:140])))
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("requestfailed", lambda r: failed.append([r.url[:110], str(r.failure)]))
            pg.on("request", lambda r: reqs.update([r.url.split('?')[0][:60]]))
            await pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await pg.wait_for_timeout(9000)
            s1 = await pg.evaluate(SNAP)
            await pg.wait_for_timeout(10000)   # 3초 갱신 여러 번 관찰
            s2 = await pg.evaluate(SNAP)
            share = await pg.evaluate("() => window.buildShareText()")
            await pg.screenshot(path=f"{OUT}/{name}.png", full_page=True)
            print("==", name, "| status:", s2["status"], "| count:", s2["count"], "| overflow:", s2["overflow"])
            for c in s2["cards"]:
                flag = "" if c["num"] not in ("–", "") else "  ❌"
                print(f"   {c['id']:<9} {c['num']:>13} {c['delta'][:24]:<24} {c['tag']:<4} {c['src']}{flag}")
            changed = sum(1 for a, c in zip(s1["cards"], s2["cards"]) if a["num"] != c["num"])
            print("   값 변동 카드:", changed, "| 콘솔:", logs, "| 에러:", errs, "| 실패:", failed)
            print("   요청 수(10초+):", dict(reqs))
            print("   공유문구:", json.dumps(share, ensure_ascii=False)[:600])
            await ctx.close()
        await b.close()

asyncio.run(main()); httpd.shutdown()
