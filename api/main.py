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

app = FastAPI(title="HIT Scout API V3 (Deep Scan)", version="3.0")

# CORS - დაშვებები ფრონტისთვის
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION (შეავსე შენი მონაცემებით!) ---
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "your_email@gmail.com"  # <-- ჩაწერე გამგზავნი მეილი
SMTP_PASSWORD = "your_app_password" # <-- ჩაწერე Google App Password

# Browser Headers (ბლოკის თავიდან ასაცილებლად)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ka;q=0.8"
}

# --- 1. REAL SSL VERIFICATION (Socket Level) ---
def get_ssl_info(domain: str):
    """
    ფიზიკურად უკავშირდება 443 პორტს და ამოწმებს სერთიფიკატს.
    """
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
                    "expiry": not_after.strftime("%Y-%m-%d")
                }
    except Exception as e:
        return {"valid": False, "error": str(e)}

# --- 2. DEEP CONTENT CRAWLER ---
async def crawl_inner_pages(client, base_url, soup):
    """
    ეძებს About/Contact გვერდებს და იქიდანაც მოაქვს ინფო.
    """
    keywords_found = []
    links = [a.get('href') for a in soup.find_all('a', href=True)]
    
    targets = ['about', 'story', 'history', 'contact', 'ჩვენ', 'ისტორია']
    target_url = None
    
    for link in links:
        for t in targets:
            if t in link.lower():
                target_url = urljoin(base_url, link)
                break
        if target_url: break
    
    if target_url:
        try:
            resp = await client.get(target_url, headers=HEADERS, timeout=5)
            inner_text = resp.text.lower()
            if "wedding" in inner_text or "ქორწილი" in inner_text: keywords_found.append("Events/Weddings")
            if "conference" in inner_text or "კონფერენცია" in inner_text: keywords_found.append("MICE/Business")
            if "tasting" in inner_text or "დეგუსტაცია" in inner_text: keywords_found.append("Wine Tasting")
        except:
            pass
            
    return keywords_found

# --- 3. ADVANCED TECH DETECTION ---
def analyze_advanced_stack(html: str, headers: dict):
    html = html.lower()
    stack = []
    
    # CMS / Frameworks
    if "wp-content" in html: stack.append("WordPress")
    if "wix.com" in html: stack.append("Wix")
    if "shopify" in html: stack.append("Shopify")
    if "squarespace" in html: stack.append("Squarespace")

    # Analytics & Ads
    if "gtm-" in html or "googletagmanager" in html: stack.append("Google Tag Manager")
    if "ua-" in html or "g-" in html: stack.append("Google Analytics 4")
    if "fbevents.js" in html: stack.append("Facebook Pixel")

    # Hospitality Engines
    booking_patterns = {
        "siteminder": "SiteMinder",
        "cloudbeds": "Cloudbeds",
        "profitroom": "Profitroom",
        "synxis": "SynXis",
        "travelclick": "TravelClick",
        "simplebooking": "SimpleBooking"
    }
    
    for key, name in booking_patterns.items():
        if key in html:
            stack.append(f"Booking Engine ({name})")

    # Server Tech
    if "server" in headers:
        srv = headers["server"].lower()
        if "cloudflare" in srv: stack.append("Cloudflare CDN")
        if "nginx" in srv: stack.append("Nginx")

    return list(set(stack))

# --- EMAIL SENDER ---
def send_email_report(to_email, domain, score, stack, findings):
    if not to_email or "@" not in to_email: return
    
    subject = f"HIT Audit: {domain} - Score: {score}/100"
    html_body = f"""
    <h2>HIT Hub Intelligence Report</h2>
    <p>Domain: <strong>{domain}</strong></p>
    <h1>Score: {score}</h1>
    <hr>
    <h3>Detected Tech:</h3>
    <ul>{''.join([f'<li>{t}</li>' for t in stack])}</ul>
    <h3>Findings:</h3>
    <ul>{''.join([f'<li>{f}</li>' for f in findings])}</ul>
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
    except Exception as e:
        print(f"Email Error: {e}")

# --- MAIN LOGIC ---
@app.get("/api/audit-v2")
async def audit_v3_deep(
    background_tasks: BackgroundTasks,
    domain: str = Query(..., description="Target Domain"),
    email: Optional[str] = None
):
    start_time = time.time()
    clean_domain = domain.replace("https://", "").replace("http://", "").split("/")[0].strip()
    
    # 1. SSL Check
    ssl_data = get_ssl_info(clean_domain)
    
    # 2. HTTP Request
    target_url = f"https://{clean_domain}"
    async with httpx.AsyncClient(verify=False, follow_redirects=True) as client:
        try:
            req_start = time.time()
            resp = await client.get(target_url, headers=HEADERS, timeout=10)
            load_time = round(time.time() - req_start, 2)
            html_content = resp.text
            response_headers = resp.headers
        except:
            # Fallback to HTTP
            try:
                target_url = f"http://{clean_domain}"
                req_start = time.time()
                resp = await client.get(target_url, headers=HEADERS, timeout=10)
                load_time = round(time.time() - req_start, 2)
                html_content = resp.text
                response_headers = resp.headers
                ssl_data["valid"] = False
            except:
                return {"error": "Site Unreachable", "domain": clean_domain}

    # 3. Deep Analysis
    soup = BeautifulSoup(html_content, 'html.parser')
    extra_services = await crawl_inner_pages(httpx.AsyncClient(verify=False), str(resp.url), soup)
    tech_stack = analyze_advanced_stack(html_content, response_headers)
    
    # 4. Scoring
    score = 100
    findings = []

    if not ssl_data['valid']:
        score -= 25
        findings.append("Critical: SSL Certificate Invalid")
    if load_time > 2.5:
        score -= 15
        findings.append(f"Performance: Slow Load ({load_time}s)")
    if not any("Google" in t for t in tech_stack):
        score -= 20
        findings.append("No Analytics Detected")

    # 5. Email
    if email:
        background_tasks.add_task(send_email_report, email, clean_domain, score, tech_stack, findings)

    return {
        "meta": {
            "domain": clean_domain,
            "scan_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "hit_score": max(score, 10),
            "duration_sec": load_time
        },
        "technical": {
            "ssl_info": ssl_data,
            "is_https": ssl_data['valid'],
            "server": response_headers.get("server", "Hidden")
        },
        "intelligence": {
            "detected_stack": tech_stack,
            "extra_services": extra_services,
            "business_type": ["Hospitality"] if "hotel" in html_content.lower() else []
        }
    }
