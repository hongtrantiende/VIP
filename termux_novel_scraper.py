import os
import re
import time
import random
import requests
import json
import uuid
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from ebooklib import epub
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

class NovelDownloader:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self.novel_info = {
            'title': 'Unknown',
            'author': 'Unknown',
            'cover': '',
            'chapters': []
        }
        self.save_dir = "downloads"
        if not os.path.exists(self.save_dir):
            os.makedirs(self.save_dir)

    def _get_page(self, url):
        try:
            time.sleep(random.uniform(0.5, 1.5))
            response = self.session.get(url, headers=self.headers, timeout=10)
            response.raise_for_status()
            # Detect encoding
            if response.encoding == 'ISO-8859-1':
                response.encoding = response.apparent_encoding
            return BeautifulSoup(response.text, 'lxml')
        except Exception as e:
            print(f"\n[!] Lỗi khi tải trang {url}: {e}")
            return None

    def extract_metadata(self, url):
        print(f"[*] Đang lấy thông tin truyện từ: {url}")
        soup = self._get_page(url)
        if not soup: return False

        # Thử tìm các tag phổ biến
        title_tag = soup.find('h1') or soup.find('h2') or soup.find('title')
        self.novel_info['title'] = title_tag.get_text(strip=True) if title_tag else "Truyen_Download"
        
        # Làm sạch tên file
        self.novel_info['title'] = re.sub(r'[\\/*?:"<>|]', "", self.novel_info['title'])

        # Tìm tác giả
        author_patterns = ['tác giả', 'author', 'tac gia']
        for p in author_patterns:
            author_tag = soup.find(string=re.compile(p, re.I))
            if author_tag:
                parent = author_tag.parent
                self.novel_info['author'] = parent.get_text(strip=True).replace(author_tag, "").strip(": ")
                break

        # Tìm ảnh bìa
        img_tag = soup.find('img', {'src': re.compile(r'(cover|thumb|book)', re.I)})
        if img_tag:
            self.novel_info['cover'] = urljoin(url, img_tag['src'])

        # Tìm danh sách chương
        print("[*] Đang tìm danh sách chương...")
        links = soup.find_all('a', href=True)
        chapter_links = []
        for link in links:
            text = link.get_text(strip=True)
            href = link['href']
            # Regex tìm "Chương X" hoặc "Chapter X"
            if re.search(r'(chương|chapter|quyển|tập)\s+\d+', text, re.I):
                full_url = urljoin(url, href)
                if full_url not in [c['url'] for c in chapter_links]:
                    chapter_links.append({'title': text, 'url': full_url})

        # Nếu không tìm thấy, có thể đây là link chapter 1
        if not chapter_links:
            print("[!] Không thấy danh sách chương, thử quét từ chương hiện tại...")
            # Logic nâng cao có thể thêm ở đây để tìm nút "Next"
            chapter_links.append({'title': 'Chương 1', 'url': url})

        self.novel_info['chapters'] = chapter_links
        print(f"[+] Tìm thấy {len(chapter_links)} chương.")
        return True

    def clean_content(self, soup):
        # Xóa các tag không cần thiết
        for tag in soup(['script', 'style', 'iframe', 'ads', 'nav', 'footer', 'header']):
            tag.decompose()
        
        # Tìm div chứa nội dung (thường là có id/class content, chap-content, etc)
        content_div = soup.find('div', class_=re.compile(r'(content|chap|read|novel-text)', re.I)) \
                      or soup.find('div', id=re.compile(r'(content|chap|read|novel-text)', re.I)) \
                      or soup.find('article')
        
        if not content_div:
            # Fallback lấy body
            content_div = soup.find('body')

        # Làm sạch text
        text = ""
        for p in content_div.find_all(['p', 'div', 'br']):
            line = p.get_text(strip=True)
            if line and len(line) > 5: # Bỏ qua dòng quá ngắn (thường là rác)
                # Bỏ qua quảng cáo phổ biến
                if any(x in line.lower() for x in ['quảng cáo', 'ads', 'click', 'truyenfull', 'metruyenchu']):
                    continue
                text += line + "\n\n"
        
        return text.strip()

    def download_chapters(self, start_idx=0, end_idx=None):
        chapters = self.novel_info['chapters']
        if end_idx is None: end_idx = len(chapters)
        
        subset = chapters[start_idx:end_idx]
        results = []
        
        novel_path = os.path.join(self.save_dir, self.novel_info['title'])
        if not os.path.exists(novel_path): os.makedirs(novel_path)

        # File resume
        resume_file = os.path.join(novel_path, "resume.json")
        downloaded = {}
        if os.path.exists(resume_file):
            with open(resume_file, 'r', encoding='utf-8') as f:
                downloaded = json.load(f)

        print(f"[*] Bắt đầu tải {len(subset)} chương...")
        pbar = tqdm(total=len(subset), desc="Tiến trình")

        for i, chap in enumerate(subset):
            chap_id = f"chap_{start_idx + i + 1}"
            
            # Check resume
            if chap_id in downloaded and os.path.exists(os.path.join(novel_path, f"{chap_id}.txt")):
                pbar.update(1)
                results.append(downloaded[chap_id])
                continue

            soup = self._get_page(chap['url'])
            if soup:
                content = self.clean_content(soup)
                chap_data = {
                    'title': chap['title'],
                    'content': content,
                    'url': chap['url']
                }
                
                # Lưu file tạm
                with open(os.path.join(novel_path, f"{chap_id}.txt"), "w", encoding='utf-8') as f:
                    f.write(f"{chap['title']}\n\n{content}")
                
                downloaded[chap_id] = chap_data
                with open(resume_file, 'w', encoding='utf-8') as f:
                    json.dump(downloaded, f, ensure_ascii=False, indent=4)
                
                results.append(chap_data)
            
            pbar.update(1)
        
        pbar.close()
        return results

    def export_txt(self, data):
        filename = f"{self.novel_info['title']}.txt"
        path = os.path.join(self.save_dir, filename)
        with open(path, "w", encoding='utf-8') as f:
            f.write(f"TÊN TRUYỆN: {self.novel_info['title']}\n")
            f.write(f"TÁC GIẢ: {self.novel_info['author']}\n")
            f.write("-" * 30 + "\n\n")
            for chap in data:
                f.write(f"=== {chap['title']} ===\n\n")
                f.write(chap['content'])
                f.write("\n\n" + "="*50 + "\n\n")
        print(f"[+] Đã xuất file TXT: {path}")

    def export_epub(self, data):
        book = epub.EpubBook()
        book.set_identifier(str(hash(self.novel_info['title'])))
        book.set_title(self.novel_info['title'])
        book.set_language('vi')
        book.add_author(self.novel_info['author'])

        # Cover (nếu có)
        if self.novel_info['cover']:
            try:
                resp = self.session.get(self.novel_info['cover'])
                book.set_cover("cover.jpg", resp.content)
            except: pass

        chapters_epub = []
        for i, chap in enumerate(data):
            c = epub.EpubHtml(title=chap['title'], file_name=f'chap_{i+1}.xhtml', lang='vi')
            content_html = f"<h1>{chap['title']}</h1>"
            content_html += "".join([f"<p>{p}</p>" for p in chap['content'].split('\n') if p.strip()])
            c.content = content_html
            book.add_item(c)
            chapters_epub.append(c)

        book.toc = tuple(chapters_epub)
        book.add_item(epub.EpubNcx())
        book.add_item(epub.EpubNav())
        
        style = 'body { font-family: "Times New Roman", serif; } h1 { text-align: center; }'
        nav_css = epub.EpubItem(uid="style_nav", file_name="style/nav.css", media_type="text/css", content=style)
        book.add_item(nav_css)

        book.spine = ['nav'] + chapters_epub
        
        epub_path = os.path.join(self.save_dir, f"{self.novel_info['title']}.epub")
        epub.write_epub(epub_path, book, {})
        print(f"[+] Đã xuất file EPUB: {epub_path}")

    def export_novel_studio_json(self, data, source_url=""):
        now = datetime.now(timezone.utc).isoformat()
        novel_id = str(uuid.uuid4())
        
        novel_obj = {
            "id": novel_id,
            "title": self.novel_info['title'],
            "author": self.novel_info['author'],
            "coverImage": self.novel_info['cover'],
            "sourceUrl": source_url,
            "status": "ongoing",
            "totalChapters": len(data),
            "chaptersAnalyzed": 0,
            "createdAt": now,
            "updatedAt": now
        }
        
        chapters_list = []
        scenes_list = []
        
        for i, chap in enumerate(data):
            chapter_id = str(uuid.uuid4())
            scene_id = str(uuid.uuid4())
            
            chapters_list.append({
                "id": chapter_id,
                "novelId": novel_id,
                "title": chap['title'],
                "order": i,
                "createdAt": now,
                "updatedAt": now
            })
            
            # Tính word count đơn giản
            word_count = len([w for w in re.split(r'\s+', chap['content']) if w])
            
            scenes_list.append({
                "id": scene_id,
                "novelId": novel_id,
                "chapterId": chapter_id,
                "content": chap['content'],
                "wordCount": word_count,
                "order": 0,
                "version": 0,
                "versionType": "manual",
                "isActive": 1,
                "createdAt": now,
                "updatedAt": now
            })
            
        export_data = {
            "version": 2,
            "exportedAt": now,
            "novel": novel_obj,
            "chapters": chapters_list,
            "scenes": scenes_list,
            "characters": [],
            "notes": []
        }
        
        filename = f"{self.novel_info['title'].replace(' ', '_')}.novel.json"
        path = os.path.join(self.save_dir, filename)
        with open(path, "w", encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False)
            
        print(f"[+] Đã xuất file JSON (để nhập vào Web): {path}")

def main():
    print("="*40)
    print("   TOOL TẢI TRUYỆN TERMUX - BY ANTIGRAVITY")
    print("="*40)
    
    downloader = NovelDownloader()
    
    url = input(" Nhập link truyện (TOC hoặc Chapter 1): ")
    if not url.startswith('http'):
        print("[!] Link không hợp lệ!")
        return

    if not downloader.extract_metadata(url):
        print("[!] Không thể lấy thông tin truyện.")
        return

    print(f"\n TRUYỆN: {downloader.novel_info['title']}")
    print(f" TÁC GIẢ: {downloader.novel_info['author']}")
    print(f" TỔNG SỐ CHƯƠNG: {len(downloader.novel_info['chapters'])}")

    print("\n--- MENU ---")
    print("1. Tải toàn bộ")
    print("2. Tải một khoảng (X đến Y)")
    print("3. Thoát")
    
    choice = input("Chọn: ")
    
    start_idx, end_idx = 0, None
    if choice == '2':
        start_idx = int(input(f"Nhập chương bắt đầu (1-{len(downloader.novel_info['chapters'])}): ")) - 1
        end_idx = int(input(f"Nhập chương kết thúc (1-{len(downloader.novel_info['chapters'])}): "))
    elif choice != '1':
        return

    data = downloader.download_chapters(start_idx, end_idx)
    
    print("\n--- XUẤT FILE ---")
    print("1. Chỉ TXT")
    print("2. Chỉ EPUB")
    print("3. Chỉ JSON (để nhập vào Web Thuyết Thư Các: https://thi-n-th-vip.vercel.app/dashboard)")
    print("4. Tất cả")
    
    export_choice = input("Chọn: ")
    if export_choice in ['1', '4']:
        downloader.export_txt(data)
    if export_choice in ['2', '4']:
        downloader.export_epub(data)
    if export_choice in ['3', '4']:
        downloader.export_novel_studio_json(data, url)
        print("\n[!] Hướng dẫn: Mở https://thi-n-th-vip.vercel.app/import trên trình duyệt và tải file JSON vừa tạo lên.")

    print("\n[✔] Hoàn thành! File được lưu trong thư mục 'downloads'.")

if __name__ == "__main__":
    main()
