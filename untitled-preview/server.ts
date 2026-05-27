import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';

const app = express();
const PORT = 3000;

app.use(cors());

const TRUYENFULL_URL = 'https://truyenfull.today';
const WIKIDICH_URL = 'https://wikicv.net';

const getHeaders = () => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
});

const getSlug = (url: string) => {
  if (!url) return '';
  const parts = url.split('/').filter(p => p);
  return parts[parts.length - 1] || '';
};

const getWikiSlug = (url: string) => {
  if (!url) return '';
  const parts = url.split('/').filter(p => p);
  return parts[parts.length - 1] || '';
};

// WikiDich Signature Logic
const WIKI_SIGN_FUNC = `function a(W){function V(d,c){return d>>>c|d<<32-c}for(var U,T,S=Math.pow,R=S(2,32),Q="length",P="",O=[],N=8*W[Q],M=a.h=a.h||[],L=a.k=a.k||[],K=L[Q],J={},I=2;64>K;I++){if(!J[I]){for(U=0;313>U;U+=I){J[U]=I}M[K]=S(I,0.5)*R|0,L[K++]=S(I,1/3)*R|0}}for(W+="\x80";W[Q]%64-56;){W+="\x00"}for(U=0;U<W[Q];U++){if(T=W.charCodeAt(U),T>>8){return}O[U>>2]|=T<<(3-U)%4*8}for(O[O[Q]]=N/R|0,O[O[Q]]=N,T=0;T<O[Q];){var H=O.slice(T,T+=16),G=M;for(M=M.slice(0,8),U=0;64>U;U++){var F=H[U-15],E=H[U-2],D=M[0],C=M[4],B=M[7]+(V(C,6)^V(C,11)^V(C,25))+(C&M[5]^~C&M[6])+L[U]+(H[U]=16>U?H[U]:H[U-16]+(V(F,7)^V(F,18)^F>>>3)+H[U-7]+(V(E,17)^V(E,19)^E>>>10)|0),A=(V(D,2)^V(D,13)^V(D,22))+(D&M[1]^D&M[2]^M[1]&M[2]);M=[B+A|0].concat(M),M[4]=M[4]+B|0}for(U=0;8>U;U++){M[U]=M[U]+G[U]|0}}for(U=0;8>U;U++){for(T=3;T+1;T--){var z=M[U]>>8*T&255;P+=(16>z?0:"")+z.toString(16)}}return P}`;
const signFunc = new Function('W', `return (${WIKI_SIGN_FUNC})(W);`) as any;
function fuzzySign(text: string, offset: number) { return text.substring(offset) + text.substring(0, offset); }

let cachedWikiCookie = '';

async function getWikiCookie(): Promise<string> {
    return cachedWikiCookie;
}

// 1. Get Home (Hot stories)
app.get('/api/home', async (req, res) => {
  try {
    const source = req.query.source || 'truyenfull';
    
    if (source === 'truyenfull') {
      const { data } = await axios.get(TRUYENFULL_URL, { headers: getHeaders() });
      const $ = cheerio.load(data);
      const hotStories: any[] = [];
      $('.index-intro .item').each((_, el) => {
         const url = $(el).find('a').attr('href') || '';
         const title = $(el).find('h3').text().trim();
         const coverImg = $(el).find('img').attr('src');
         if (title && url) {
            hotStories.push({ title, slug: getSlug(url), cover: coverImg });
         }
      });
      
      const newUpdates: any[] = [];
      const { data: newUpdatesData } = await axios.get(`${TRUYENFULL_URL}/danh-sach/truyen-moi/`, { headers: getHeaders() });
      const $new = cheerio.load(newUpdatesData);
      $new('.list-truyen .row').each((_, el) => {
         const url = $new(el).find('h3.truyen-title a').attr('href');
         const title = $new(el).find('h3.truyen-title a').text().trim();
         const chapterUrl = $new(el).find('.text-info a').attr('href');
         const chapterTitle = $new(el).find('.text-info a').text().trim();
         if (title && url) {
            newUpdates.push({
              title, slug: getSlug(url),
              latestChapter: chapterTitle, latestChapterSlug: getSlug(chapterUrl || '')
            });
         }
      });
      res.json({ hotStories, newUpdates });
    } else if (source === 'wikidich') {
      const wikiCookie = await getWikiCookie();
      const reqHeaders = { ...getHeaders() };
      if (wikiCookie) reqHeaders['Cookie'] = wikiCookie;
      const { data } = await axios.get(WIKIDICH_URL, { headers: reqHeaders });
      const $ = cheerio.load(data);
      const hotStories: any[] = [];
      const newUpdates: any[] = [];
      
      $('.book-item').each((i, el) => {
         const url = $(el).find('a').first().attr('href') || '';
         const title = $(el).find('.book-title').text().trim();
         const coverImg = $(el).find('img').attr('src');
         const author = $(el).find('.author').text().trim();
         
         const itm = {
            title, slug: getWikiSlug(url), 
            cover: coverImg ? `${WIKIDICH_URL}${coverImg}` : '', 
            author
         };
         if (title && url) {
            if (i < 8) hotStories.push(itm);
            else newUpdates.push({...itm, latestChapter: 'Đang ra...', latestChapterSlug: 'chuong-moi-nhat'});
         }
      });
      res.json({ hotStories, newUpdates });
    } else if (source === 'sangtacviet') {
      // Sangtacviet anti-bot blocks headless scraping heavily. Returning placeholders.
      res.json({
        hotStories: [
           { title: 'Sáng Tác Việt bị chặn Anti-bot', slug: 'error', cover: '', author: 'Hệ thống' }
        ],
        newUpdates: []
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Search
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q as string;
    const source = req.query.source || 'truyenfull';
    if (!q) return res.json({ results: [] });
    
    if (source === 'truyenfull') {
      const searchUrl = `${TRUYENFULL_URL}/tim-kiem/?tukhoa=${encodeURIComponent(q)}`;
      const { data } = await axios.get(searchUrl, { headers: getHeaders() });
      const $ = cheerio.load(data);
      const results: any[] = [];
      $('.list-truyen .row').each((_, el) => {
         const url = $(el).find('h3.truyen-title a').attr('href');
         const title = $(el).find('h3.truyen-title a').text().trim();
         const author = $(el).find('.author').text().trim();
         const chapter = $(el).find('.text-info a').text().trim();
         if (title && url) {
             results.push({ title, slug: getSlug(url), author, latestChapter: chapter });
         }
      });
      res.json({ results });
    } else {
      const wikiCookie = await getWikiCookie();
      const searchUrl = `${WIKIDICH_URL}/tim-kiem?q=${encodeURIComponent(q)}`;
      const reqHeaders = { ...getHeaders() };
      if (wikiCookie) reqHeaders['Cookie'] = wikiCookie;
      const { data } = await axios.get(searchUrl, { headers: reqHeaders });
      const $ = cheerio.load(data);
      const results: any[] = [];
      $('.book-item').each((_, el) => {
         const url = $(el).find('a').first().attr('href') || '';
         const title = $(el).find('.book-title').text().trim();
         const author = $(el).find('.author').text().trim();
         if (title && url) {
             results.push({ title, slug: getWikiSlug(url), author, latestChapter: 'Đang ra...' });
         }
      });
      res.json({ results });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Story Details
app.get('/api/story/:slug', async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const page = req.query.page || 1;
    const source = req.query.source || 'truyenfull';
    
    if (source === 'truyenfull') {
      let url = `${TRUYENFULL_URL}/${slug}/`;
      if (page && page !== '1') url += `trang-${page}/`;
      const { data } = await axios.get(url, { headers: getHeaders() });
      const $ = cheerio.load(data);
      
      const title = $('h3.title').text().trim() || '';
      const author = $('.info a[itemprop="author"]').text().trim() || 'Đang cập nhật';
      const desc = $('.desc-text').html()?.trim() || '';
      const cover = $('.book img').attr('src');
      
      const chapters: any[] = [];
      $('.list-chapter li a').each((_, el) => {
         const t = $(el).text().trim();
         const chapUrl = $(el).attr('href');
         if (t && chapUrl) chapters.push({ title: t, slug: getSlug(chapUrl) });
      });
      
      let totalPages = 1;
      $('.pagination li a').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('trang-')) {
           const match = href.match(/trang-(\d+)/);
           if (match) {
              const pNum = parseInt(match[1]);
              if (pNum > totalPages) totalPages = pNum;
           }
        }
      });
      res.json({ title, slug, author, cover, desc, chapters, totalPages, currentPage: parseInt(page as string) });
    } else {
      const wikiCookie = await getWikiCookie();
      const reqHeaders = { ...getHeaders() };
      if (wikiCookie) reqHeaders['Cookie'] = wikiCookie;
      const url = `${WIKIDICH_URL}/truyen/${slug}`;
      const { data } = await axios.get(url, { headers: reqHeaders });
      const $ = cheerio.load(data);
      
      const title = $('h2').first().text().trim() || 'N/A';
      const author = $('a[href*="/tac-gia/"]').first().text().trim() || 'Đang cập nhật';
      const desc = $('.book-desc-detail').html()?.trim() || '';
      const c = $('img.materialboxed').attr('src');
      const cover = c && c.startsWith('/') ? `${WIKIDICH_URL}${c}` : c;
      
      const signKeyMatch = data.match(/signKey\s*=\s*['"](.*?)['"]/);
      const bookIdMatch = data.match(/bookId\s*=\s*['"](.*?)['"]/);
      const loadIndexMatch = data.match(/loadBookIndex\s*\(\s*(\d+)\s*,\s*(\d+)/);
      const fuzzySignMatch = data.match(/fuzzySign[^{]*{\s*return\s*text\.substring\((\d+)\)/);
      
      let chapters: any[] = [];
      if (signKeyMatch && bookIdMatch && loadIndexMatch && fuzzySignMatch) {
          const signKey = signKeyMatch[1];
          const bookId = bookIdMatch[1];
          const start = parseInt(loadIndexMatch[1], 10);
          const size = parseInt(loadIndexMatch[2], 10);
          const offset = parseInt(fuzzySignMatch[1], 10);
          const b = signFunc(fuzzySign(signKey + start + size, offset));
          try {
              const {data: indexData} = await axios.get(`${WIKIDICH_URL}/book/index`, {
                  params: { bookId, start, size, signKey, sign: b },
                  headers: Object.assign({}, getHeaders(), { 'Referer': url })
              });
              const $idx = cheerio.load(indexData);
              $idx('.chapter-name a').each((_, el) => {
                 const t = $idx(el).text().trim();
                 const u = $idx(el).attr('href');
                 // For wikiDich chapter URL is like /truyen/slug/chapter_slug
                 if (t && u) chapters.push({ title: t, slug: getWikiSlug(u) });
              });
          } catch(e) { console.error("Error fetching wikidich chapters: ", e); }
      }
      res.json({ title, slug, author, cover, desc, chapters, totalPages: 1, currentPage: 1 });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Chapter details
app.get('/api/chapter/:slug/*', async (req, res) => {
  try {
     const slug = req.params.slug as string;
     const chapterSlug = req.params[0] as string;
     const source = req.query.source || 'truyenfull';
     
     if (source === 'truyenfull') {
         const url = `${TRUYENFULL_URL}/${slug}/${chapterSlug}/`;
         const { data } = await axios.get(url, { headers: getHeaders() });
         const $ = cheerio.load(data);
         
         const title = $('.chapter-title').text().trim() || 'Chương không rõ';
         const storyTitle = $('.truyen-title').text().trim() || 'Truyện không rõ';
         const content = $('#chapter-c').html() || '<p>Không thể tải nội dung (hoặc web chặn bots).</p>';
         
         const prevUrl = $('#prev_chap').attr('href');
         const nextUrl = $('#next_chap').attr('href');
         
         res.json({
            title, storyTitle, content,
            externalApi: `${TRUYENFULL_URL}/${slug}/${chapterSlug}`,
            prevSlug: !prevUrl || prevUrl.includes('javascript') ? null : getSlug(prevUrl),
            nextSlug: !nextUrl || nextUrl.includes('javascript') ? null : getSlug(nextUrl)
         });
     } else {
         const wikiCookie = await getWikiCookie();
         const reqHeaders = { ...getHeaders() };
         if (wikiCookie) reqHeaders['Cookie'] = wikiCookie;
         const url = `${WIKIDICH_URL}/truyen/${slug}/${chapterSlug}`;
         const { data } = await axios.get(url, { headers: reqHeaders });
         const $ = cheerio.load(data);
         
         const title = $('title').text().split('- Chương')[1]?.trim() || 'Chương';
         const storyTitle = $('title').text().split('- Chương')[0]?.trim() || 'Truyện';
         const content = $('#bookContentBody').html() || '<p>Không thể tải nội dung.</p>';
         
         const prevUrl = $('#btnPreChapter').attr('href');
         const nextUrl = $('#btnNextChapter').attr('href');
         
         res.json({
            title, storyTitle, content,
            externalApi: url,
            prevSlug: !prevUrl || prevUrl.includes('javascript') ? null : getWikiSlug(prevUrl),
            nextSlug: !nextUrl || nextUrl.includes('javascript') ? null : getWikiSlug(nextUrl)
         });
     }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Lists
app.get('/api/list/:type', async (req, res) => {
  try {
     const { type } = req.params;
     const page = req.query.page || 1;
     const source = req.query.source || 'truyenfull';
     
     if (source === 'wikidich') {
        const start = (parseInt(page as string) - 1) * 20;
        const wikiCookie = await getWikiCookie();
        const url = `${WIKIDICH_URL}/${type}?start=${start}`;
        const reqHeaders = { ...getHeaders() };
        if (wikiCookie) reqHeaders['Cookie'] = wikiCookie;
        
        const { data } = await axios.get(url, { headers: reqHeaders });
        const $ = cheerio.load(data);
        
        let title = type;
        if (type === 'chuong-moi') title = 'Chương mới';
        if (type === 'truyen-nam') title = 'Truyện nam';
        if (type === 'nu-tan') title = 'Nữ tần';
        if (type === 'dam-my') title = 'Đam mỹ';

        const results: any[] = [];
        $('.book-item').each((_, el) => {
           const u = $(el).find('a').first().attr('href');
           const t = $(el).find('.book-title').text().trim();
           const author = $(el).find('.author').text().trim();
           if (t && u) {
               results.push({ title: t, slug: getWikiSlug(u), author, latestChapter: 'Đang ra...' });
           }
        });

        let totalPages = 1;
        $('.pagination li a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('start=')) {
                const match = href.match(/start=(\d+)/);
                if (match) {
                    const maxStart = parseInt(match[1]);
                    const pNum = Math.floor(maxStart / 20) + 1;
                    if (pNum > totalPages) totalPages = pNum;
                }
            }
        });

        res.json({ title, results, totalPages, currentPage: parseInt(page as string) });
        return;
     }

     let url = `${TRUYENFULL_URL}/danh-sach/${type}/`;
     if (page && page !== '1') url += `trang-${page}/`;
     
     const { data } = await axios.get(url, { headers: getHeaders() });
     const $ = cheerio.load(data);
     
     const title = $('.title-list h2').text().trim() || type;
     const results: any[] = [];
     $('.list-truyen .row').each((_, el) => {
        const a = $(el).find('h3.truyen-title a');
        const url = a.attr('href');
        const titleText = a.text().trim();
        const author = $(el).find('.author').text().trim();
        const chapterUrl = $(el).find('.text-info a').attr('href');
        const chapter = $(el).find('.text-info a').text().trim();
        if (titleText && url) {
            results.push({
                title: titleText, slug: getSlug(url), author,
                latestChapter: chapter, latestChapterSlug: getSlug(chapterUrl || '')
            });
        }
     });
     
     let totalPages = 1;
     $('.pagination li a').each((_, el) => {
       const href = $(el).attr('href');
       if (href && href.includes('trang-')) {
          const match = href.match(/trang-(\d+)/);
          if (match) {
             const pNum = parseInt(match[1]);
             if (pNum > totalPages) totalPages = pNum;
          }
       }
     });
     res.json({ title, results, totalPages, currentPage: parseInt(page as string) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
