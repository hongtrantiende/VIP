import requests
import re

url = "https://chomered.com/book/chapter/18690052"
response = requests.get(url)
html = response.text

# Find CSS files
css_files = re.findall(r'href="(https?://[^"]+\.css)"', html)
print("CSS Files found:")
for css in css_files:
    print(css)
    if "novel" in css or "style" in css:
        css_content = requests.get(css).text
        if ".icon-" in css_content:
            print(f"Mapping found in {css}")
            mappings = re.findall(r'\.icon-(\d+):before\{content:"([^"]+)"\}', css_content)
            for m in mappings:
                print(f"{m[0]}: {m[1]}")
