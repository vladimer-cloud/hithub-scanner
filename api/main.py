from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import httpx
import time
import ssl
import socket
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
from typing import List, Optional, Dict

# ინიციალიზაცია
app = FastAPI(title="HIT Scout API V3 Full", version="3.3")

# 🚨 CORS FIX: ეს არის მთავარი! ვხსნით ყველასთვის.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # უშვებს მოთხოვნას ნებისმიერი საიტიდან
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION (აქ ჩაწერე შენი მონაცემები) ---
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "your_email@gmail.com"  # <--- ჩაწერე შენი მეილი
SMTP_PASSWORD = "your_app_password" # <--- ჩაწერე Google App Password

# ბრაუზერის ჰედერები (რომ საიტმა არ დაგვბლოკოს)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ka;q=0.8"
}

# --- 1. SSL შემოწმება (სოკეტის დონეზე) ---
def get_ssl_info(domain: str):
    """ამოწმებს სერთიფიკატს პირდაპირი კავშირით 443 პორტზე"""
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                not_after = datetime.strptime(cert['notAfter'], '%b %d %H:%M:%S %Y %Z')
                days_left = (not_after - datetime.now()).days
                return {
                    "valid": True,
                    "days_left": days_left,
                    "expiry": not_after.strftime("%Y-%m-%d"),
                    "issuer": dict(x[0] for x in cert['issuer']).get('commonName', 'Unknown')
                }
    except Exception as e:
        return {"valid": False, "error": str(e)}

# --- 2. შიდა გვერდების სკანირება (Deep Crawl) ---
async def crawl_inner_pages(client, base_url, soup):
    """ეძებს About/Contact გვერდებს დამატებითი ინფორმაციისთვის"""
    keywords_found = []
    try:
        links = [a.get('href') for a in soup.find_all('a', href=True)]
        targets = ['about', 'story', 'history', 'contact', 'ჩვენ', 'ისტორია']
        target_url = None
        
        # ვეძებთ შესაბამის ლინკს
        for link in links:
            for t in targets:
                if t in link.lower():
                    target_url = urljoin(base_url, link)
                    break
            if target_url: break
        
        # თუ ვიპოვეთ, გადავდივართ და ვკითხულობთ
        if target_url:
            resp = await client.get(target_url, headers=HEADERS, timeout=8)
            inner_text = resp.text.lower()
            
            # სერვისების ძებნა ტექსტში
            if "wedding" in inner_text or "ქორწილი" in inner_text: keywords_found.append("Events & Weddings")
            if "conference" in inner_text or "კონფერენცია" in inner_text: keywords_found.append("Conference Hall")
            if "tasting" in inner_text or "დეგუსტაცია" in inner_text: keywords_found.append("Wine Tasting")
            if "pool" in inner_text or "აუზი" in inner_text: keywords_found.append("Swimming Pool")
            if "spa" in inner_text or "სპა" in inner_text: keywords_found.append("Spa & Wellness")
            if "restaurant" in inner_text or "რესტორანი" in inner_text: keywords_found.append("Restaurant")
    except:
        pass # თუ ვერ შევიდა, არაუშავს, ვაგრძელებთ
            
    return list(set(keywords_found))

# --- 3. ტექნოლოგიების ანალიზი ---
def analyze_advanced_stack(html: str, headers: dict):
    """ადგენს CMS-ს, ანალიტიკას და ჯავშნის სისტემებს"""
    html = html.lower()
    stack = []
    
    # CMS
    if "wp-content" in html: stack.append("WordPress")
    elif "wix.com" in html: stack.append("Wix")
    elif "shopify" in html: stack.append("Shopify")
    elif "squarespace" in html: stack.append("Squarespace")
    
    # Analytics
    if "gtm-" in html or "googletagmanager" in html: stack.append("Google Tag Manager")
    if "ua-" in html or "g-" in html: stack.append("Google Analytics 4")
    if "fbevents.js" in html: stack.append("Facebook Pixel")
    if "hotjar" in html: stack.append("Hotjar")

    # Booking Engines (გაფართოებული სია)
    booking_patterns = {
        "siteminder": "SiteMinder",
        "cloudbeds": "Cloudbeds",
        "profitroom": "Profitroom",
        "synxis": "SynXis",
        "travelclick": "TravelClick",
        "simplebooking": "SimpleBooking",
        "guesty": "Guesty",
        "airbnb": "Airbnb Integration",
        "booking.com": "OTA Redirect"
    }
    
    for key, name in booking_patterns.items():
        if key in html:
            stack.append(f"Booking Engine ({name})")

    # Server Info
    if "server" in headers:
        srv = headers["server"].lower()
        if "cloudflare" in srv: stack.append("Cloudflare CDN")
        if "nginx" in srv: stack.append("Nginx")
        
    return list(set(stack))

# --- 4. მეილის გაგზავნა (სრული ფუნქცია) ---
def send_email_report(to_email, domain, score, stack, findings):
    """აგზავნის HTML რეპორტს მეილზე"""
    if not to_email or "@" not in to_email: return
    if "your_email" in SMTP_USER: return # თუ მეილი არ არის გაწერილი, არ ვაგზავნით

    subject = f"HIT Audit Report: {domain} - Score: {score}/100"
    
    stack_list = "".join([f"<li>{t}</li>" for t in stack]) if stack else "<li>No specific tech detected</li>"
    findings_list = "".join([f"<li style='color:red;'>{f}</li>" for f in findings]) if findings else "<li>No critical issues found</li>"

    html_body = f"""
    <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; border-top: 5px solid #00C2A8;">
            <h2 style="color: #0f172a;">HIT Hub Intelligence Audit</h2>
            <p>მოგესალმებით,</p>
            <p>თქვენი ციფრული აუდიტი დომენისთვის <strong>{domain}</strong> დასრულებულია.</p>
            
            <div style="background: #0f172a; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                <h1 style="margin: 0; font-size: 48px;">{score}</h1>
                <p style="margin: 0; opacity: 0.8;">HIT SCORE</p>
            </div>

            <h3 style="border-bottom: 1px solid #eee; padding-bottom: 10px;">აღმოჩენილი ტექნოლოგიები:</h3>
            <ul>{stack_list}</ul>
            
            <h3 style="border-bottom: 1px solid #eee; padding-bottom: 10px;">მთავარი ხარვეზები:</h3>
            <ul>{findings_list}</ul>

            <br>
            <a href="https://hithub.ge" style="background: #00C2A8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">სრული კონსულტაცია</a>
            
            <hr style="margin-top: 30px; border: 0; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #888;">© 2024 HIT Hub System</p>
        </div>
    </div>
    """

    msg = MIMEMultipart()
    msg['From'] = SMTP_USER
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(html_body, 'html'))

    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, to_email, msg.as_string())
        server.quit()
        print(f"Email sent to {to_email}")
    except Exception as e:
        print(f"Email Error: {e}")

# --- MAIN ENDPOINT (მთავარი ლოგიკა) ---
@app.get("/api/audit-v2")
async def audit_v3_deep(
    background_tasks: BackgroundTasks,
    domain: str = Query(..., description="Target Domain"),
    email: Optional[str] = None
):
    start_time = time.time()
    
    # 1. დომენის გასუფთავება
    clean_domain = domain.replace("https://", "").replace("http://", "").split("/")[0].strip()
    if "www." in clean_domain: clean_domain = clean_domain.replace("www.", "")
    
    # 2. SSL შემოწმება
    ssl_data = get_ssl_info(clean_domain)
    
    # 3. საიტზე შესვლა (HTTP Request)
    target_url = f"https://{clean_domain}"
    async with httpx.AsyncClient(verify=False, follow_redirects=True) as client:
        try:
            req_start = time.time()
            # ვცდილობთ HTTPS-ით
            resp = await client.get(target_url, headers=HEADERS, timeout=12)
            load_time = round(time.time() - req_start, 2)
            html_content = resp.text
            response_headers = resp.headers
            final_url = str(resp.url)
        except:
            # თუ ვერ შევიდა, ვცდილობთ HTTP-ით
            try:
                target_url = f"http://{clean_domain}"
                req_start = time.time()
                resp = await client.get(target_url, headers=HEADERS, timeout=10)
                load_time = round(time.time() - req_start, 2)
                html_content = resp.text
                response_headers = resp.headers
                final_url = str(resp.url)
                ssl_data["valid"] = False # რადგან HTTP-ზე დავჯექით
            except Exception as e:
                return {"error": "Site Unreachable", "detail": str(e), "domain": clean_domain}

    # 4. მონაცემების დამუშავება
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Deep Crawl (შიდა გვერდები)
    extra_services = await crawl_inner_pages(httpx.AsyncClient(verify=False), final_url, soup)
    
    # Tech Stack
    tech_stack = analyze_advanced_stack(html_content, response_headers)
    
    # 5. ქულების დათვლა (Scoring)
    score = 100
    findings = []

    if not ssl_data['valid']:
        score -= 25
        findings.append("კრიტიკული: SSL სერთიფიკატი არასწორია ან არ არსებობს.")
    elif ssl_data.get('days_left', 100) < 15:
        score -= 10
        findings.append("გაფრთხილება: SSL ვადა გასდის 15 დღეში.")

    if load_time > 3.0:
        score -= 15
        findings.append(f"სისწრაფე: საიტი ნელა იტვირთება ({load_time}წმ).")
    
    if not any("Google" in t for t in tech_stack):
        score -= 20
        findings.append("მონაცემები: Google Analytics ვერ მოიძებნა.")

    if not any("Booking Engine" in t for t in tech_stack) and "Redirect" not in str(tech_stack):
        score -= 20
        findings.append("ჯავშნები: პირდაპირი ჯავშნის სისტემა არ ჩანს.")

    # ქულა არ უნდა იყოს უარყოფითი
    score = max(score, 10)

    # 6. მეილის გაგზავნა (ფონურ რეჟიმში)
    if email:
        background_tasks.add_task(send_email_report, email, clean_domain, score, tech_stack, findings)

    # 7. პასუხის დაბრუნება (JSON)
    return {
        "meta": {
            "domain": clean_domain,
            "scan_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "hit_score": score,
            "duration_sec": load_time
        },
        "technical": {
            "ssl_info": ssl_data,
            "is_https": ssl_data['valid'],
            "server": response_headers.get("server", "Unknown")
        },
        "intelligence": {
            "detected_stack": tech_stack,
            "extra_services": extra_services,
            "business_type": ["Hospitality"] if "hotel" in html_content.lower() else []
        },
        "findings": findings
    }
