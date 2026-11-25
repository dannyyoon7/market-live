import asyncio, collections
from playwright.async_api import async_playwright
URL="https://dannyyoon7.github.io/market-live/"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":390,"height":844}); pg=await ctx.new_page()
        bad=[]; req=collections.Counter()
        pg.on("response", lambda r: (bad.append((r.status, r.url.split('?')[0])) if r.status>=400 else None) or req.update([r.url.split('?')[0][:55]]))
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(45000)
        print("bad:", collections.Counter(bad))
        print("counts:", dict(req))
        await b.close()
asyncio.run(main())
