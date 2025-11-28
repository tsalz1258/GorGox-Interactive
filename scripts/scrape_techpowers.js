// scrape_sw5e_tech_powers.mjs
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const URL = 'https://sw5e.com/characters/techPowers';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox']});
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  // The page is a Vue app; wait a bit for the table and rows to appear.
  await page.waitForSelector('table', { timeout: 120000 });
  await sleep(1000);

  // Extract rows from the tech powers table
  const data = await page.evaluate(() => {
    // Try to find any table with a header that includes these column names
    const tables = Array.from(document.querySelectorAll('table'));
    const target = tables.find(t => {
      const headers = Array.from(t.querySelectorAll('thead th')).map(th => th.textContent.trim().toLowerCase());
      return ['tech powers','level','casting period','range','duration','concentration','source']
        .some(col => headers.join(' ').includes(col));
    }) || tables[0];

    const getText = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(target.querySelectorAll('tbody tr'));
    return rows.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      // Fallback-safe mapping by position
      return {
        name: getText(tds[0]),
        level: getText(tds[1]),
        casting_period: getText(tds[2]),
        range: getText(tds[3]),
        duration: getText(tds[4]),
        concentration: getText(tds[5]),
        source: getText(tds[6]) || 'PHB',
      };
    }).filter(r => r.name);
  });

  const out = 'sw5e_tech_powers_full.json';
  await fs.writeFile(out, JSON.stringify(data, null, 2));
  console.log(`Wrote ${data.length} entries to ${out}`);
  await browser.close();
})();
