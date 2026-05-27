import axios from 'axios';
import * as cheerio from 'cheerio';
(async () => {
  const {data} = await axios.get('https://truyenfull.today/danh-sach/truyen-moi/', {
    headers: {'User-Agent': 'Mozilla/5.0'}
  });
  const $ = cheerio.load(data);
  const items: any[] = [];
  $('.list-truyen .row').each((_, el) => {
     const a = $(el).find('h3.truyen-title a');
     const chap = $(el).find('.text-info a').text();
     items.push({ text: a.text(), chap });
  });
  console.log('List length:', items.length, items.slice(0, 3));
  
  // also check pagination
  const pages: any[] = [];
  $('.pagination li a').each((_, el) => {
     pages.push($(el).attr('href'));
  });
  console.log('Pages:', pages);
})();
