import asyncio, json
from playwright.async_api import async_playwright
URL = "https://dannyyoon7.github.io/market-live/"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp, ua in [("live-mobile", {"width":390,"height":844}, "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"),
                             ("live-desktop", {"width":1280,"height":900}, None)]:
            ctx = await b.new_context(viewport=vp, device_scale_factor=2, user_agent=ua)
            pg = await ctx.new_page()
            logs, errs, failed = [], [], []
            pg.on("console", lambda m: logs.append((m.type, m.text[:140])))
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("requestfailed", lambda r: failed.append([r.url[:110], str(r.failure)]))
            await pg.goto(URL, wait_until="load")
            await pg.wait_for_function("document.querySelector('.card[data-id=\"gold\"] .num').textContent.trim() !== '–' && document.querySelector('.card[data-id=\"btc\"] .num').textContent.trim() !== '–' && document.querySelector('.card[data-id=\"kospi\"] .num').textContent.trim() !== '–'", timeout=30000)
            await pg.wait_for_timeout(2500)
            snap = await pg.evaluate("""() => ({cards:[...document.querySelectorAll('.card')].map(c=>({id:c.dataset.id,num:c.querySelector('.num').textContent.trim(),delta:c.querySelector('.delta').textContent.replace(/\\s+/g,' ').trim(),src:c.querySelector('.src .tx').textContent.trim()})), status:document.querySelector('#statusText').textContent.trim(), overflow:document.documentElement.scrollWidth>window.innerWidth})""")
            await pg.screenshot(path=f"screenshots/{name}.png", full_page=True)
            print(name, json.dumps({"cards":snap["cards"],"status":snap["status"],"overflow":snap["overflow"],"console":logs,"pageerrors":errs,"failed":failed}, ensure_ascii=False, indent=1))
            await ctx.close()
        await b.close()
asyncio.run(main())
