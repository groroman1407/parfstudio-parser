const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const jobs = {};

app.post('/api/scan/start', async (req, res) => {
  const { url, maxPages = 60 } = req.body;
  if (!url) return res.status(400).json({ error: 'Укажите URL' });

  const jobId = 'job_' + Date.now();
  jobs[jobId] = {
    status: 'running',
    currentPage: 0,
    maxPages: parseInt(maxPages),
    items: [],
    error: null
  };

  runDeepScraper(jobId, url);
  res.json({ success: true, jobId });
});

app.get('/api/scan/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

async function runDeepScraper(jobId, startUrl) {
  const job = jobs[jobId];
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let currentUrl = startUrl;

    while (currentUrl && job.currentPage < job.maxPages) {
      job.currentPage++;

      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 1500));

      const pageProducts = await page.evaluate(() => {
        const found = [];
        const elements = document.querySelectorAll('.product, .product-card, .catalog-item, tr, li, article, .item, .goods-item, .card, .product-tile');

        elements.forEach(el => {
          const text = (el.innerText || '').trim();
          const priceMatch = text.match(/(\d[\d\s.,]*)\s*(₽|руб|рублей)/i);

          if (priceMatch) {
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const name = lines[0] ? lines[0].substring(0, 80) : '';
            const price = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
           
            const packMatch = text.match(/(\d+)\s*(г|мл|g|ml)/i);
            const pack = packMatch ? parseInt(packMatch[1]) : 10;

            if (name && name.length > 2 && !isNaN(price) && price > 0) {
              found.push({ name, price, pack });
            }
          }
        });
        return found;
      });

      pageProducts.forEach(prod => {
        const exists = job.items.some(i => i.name.toLowerCase() === prod.name.toLowerCase() && i.price === prod.price);
        if (!exists) job.items.push(prod);
      });

      const nextUrl = await page.evaluate(() => {
        const nextBtn = document.querySelector('a.next, .pagination .next, [rel="next"], .pagination-next, .pager-next a, a[title*="Следующая"]');
        return nextBtn ? nextBtn.href : null;
      });

      if (nextUrl && nextUrl !== currentUrl) {
        currentUrl = nextUrl;
      } else {
        break;
      }
    }

    job.status = 'completed';
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  } finally {
    if (browser) await browser.close();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
