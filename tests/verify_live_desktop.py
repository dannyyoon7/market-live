import asyncio, json
from playwright.async_api import async_playwright
URL = "https://dannyyoon7.github.io/market-live/"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":1280,"height":900}, device_scale_factor=1)
        pg = await ctx.new_page()
        logs, errs, failed = [], [], []
        pg.on("console", lambda m: logs.append((m.type, m.text[:160])))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("requestfailed", lambda r: failed.append([r.url[:120], str(r.failure)]))
        pg.on("response", lambda r: (logs.append(("http"+str(r.status), r.url[:100])) if r.status >= 400 else None))
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(22000)
        snap = await pg.evaluate("""() => ({cards:[...document.querySelectorAll('.card')].map(c=>({id:c.dataset.id,num:c.querySelector('.num').textContent.trim(),src:c.querySelector('.src .tx').textContent.trim()})), status:document.querySelector('#statusText').textContent.trim(), overflow:document.documentElement.scrollWidth>window.innerWidth})""")
        print(json.dumps({"snap":snap,"console":logs,"pageerrors":errs,"failed":failed}, ensure_ascii=False, indent=1))
        await pg.screenshot(path="screenshots/live-desktop.png", full_page=True)
        await b.close()
asyncio.run(main())
