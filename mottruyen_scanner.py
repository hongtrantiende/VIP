import requests
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SAVE_DIR = "downloads/mottruyen"

def setup():
    if not os.path.exists(SAVE_DIR):
        os.makedirs(SAVE_DIR)
        print(f"[*] Đã tạo thư mục lưu trữ: {SAVE_DIR}")

def fetch_story(story_id):
    url = f"http://api.mottruyen.com/story/?story_id={story_id}"
    try:
        response = requests.get(url, timeout=10)
        # Kiểm tra mã trạng thái HTTP
        if response.status_code == 200:
            try:
                data = response.json()
                # Kiểm tra nếu dữ liệu hợp lệ (tùy thuộc vào cấu trúc phản hồi của API)
                # Ví dụ: nếu API trả về {"status": false} cho truyện không tồn tại
                if data and data.get("status") is not False: 
                    # Lưu dữ liệu vào file
                    file_path = os.path.join(SAVE_DIR, f"story_{story_id}.json")
                    with open(file_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=4)
                    print(f"[+] Thành công tải truyện ID: {story_id}")
                    return True
                else:
                    print(f"[-] ID {story_id} không có dữ liệu truyện.")
                    return False
            except json.JSONDecodeError:
                print(f"[!] ID {story_id} trả về dữ liệu không phải JSON.")
                return False
        elif response.status_code == 404:
            print(f"[-] ID {story_id} không tồn tại (404).")
            return False
        else:
            print(f"[!] ID {story_id} lỗi HTTP: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"[!] ID {story_id} lỗi kết nối: {e}")
        return False

def main():
    setup()
    
    start_id = 800
    end_id = 1000000
    batch_size = 100  # Quét 100 bộ mỗi lần tải song song
    
    print(f"[*] Bắt đầu quét từ ID {start_id} đến {end_id}...")
    print(f"[*] Số luồng tải song song: {batch_size}")
    
    # Sử dụng ThreadPoolExecutor để chạy đa luồng
    with ThreadPoolExecutor(max_workers=batch_size) as executor:
        # Cắt thành từng đợt (batch) 100 bộ để dễ kiểm soát và không bị tràn RAM
        for batch_start in range(start_id, end_id + 1, batch_size):
            batch_end = min(batch_start + batch_size, end_id + 1)
            
            # Khởi tạo các luồng cho 100 ID hiện tại
            futures = [executor.submit(fetch_story, sid) for sid in range(batch_start, batch_end)]
            
            # Chờ hoàn thành đợt hiện tại
            for future in as_completed(futures):
                future.result()
                
            # Thêm sleep ngắn giữa các đợt để tránh bị block IP do request quá nhanh
            time.sleep(0.5)

if __name__ == "__main__":
    main()
